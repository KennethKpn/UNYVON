  if (!arrayMatch) return [];

  return [...arrayMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map((match) =>
    Number(match[1])
  );
}

function inlineDictionaryAt(source: string, start: number): string | null {
  if (source.slice(start, start + 2) !== "<<") return null;

  let depth = 0;
  for (let index = start; index < source.length - 1; index += 1) {
    if (source[index] === "<" && source[index + 1] === "<") {
      depth += 1;
      index += 1;
      continue;
    }
    if (source[index] === ">" && source[index + 1] === ">") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 2, index);
      index += 1;
    }
  }

  return null;
}

function inlineDictionaryValueBody(body: string, key: string): string | null {
  const keyRe = new RegExp("/" + key + "\\s*");
  const match = keyRe.exec(body);
  if (!match) return null;

  const valueStart = (match.index ?? 0) + match[0].length;
  const offset = body.slice(valueStart).search(/\\S/);
  if (offset < 0) return null;

  const absoluteStart = valueStart + offset;
  return body.slice(absoluteStart, absoluteStart + 2) === "<<"
    ? inlineDictionaryAt(body, absoluteStart)
    : null;
}

function resolveInheritedRef(
  object: PdfObject,
  key: string,
  objectsByNum: Map<number, PdfObject>,
  maxDepth = 64
): number | null {
  const visited = new Set<number>();
  let current: PdfObject | undefined = object;

  for (let depth = 0; depth < maxDepth && current; depth += 1) {
    if (visited.has(current.num)) return null;
    visited.add(current.num);

    const ref = objectRef(current.body, key);
    if (ref !== null) return ref;

    const parentRef = objectRef(current.body, "Parent");
    if (parentRef === null) return null;
    current = objectsByNum.get(parentRef);
  }

  return null;
}

function resolveInheritedDictionaryBody(
  object: PdfObject,
  key: string,
  objectsByNum: Map<number, PdfObject>,
  maxDepth = 64
): string | null {
  const ref = resolveInheritedRef(object, key, objectsByNum, maxDepth);
  if (ref !== null) {
    return objectsByNum.get(ref)?.body ?? null;
  }

  const visited = new Set<number>();
  let current: PdfObject | undefined = object;
  for (let depth = 0; depth < maxDepth && current; depth += 1) {
    if (visited.has(current.num)) return null;
    visited.add(current.num);

    const inline = inlineDictionaryValueBody(current.body, key);
    if (inline !== null) return inline;

    const parentRef = objectRef(current.body, "Parent");
    if (parentRef === null) return null;
    current = objectsByNum.get(parentRef);
  }

  return null;
}

function dictionaryValueBody(
  body: string,
  key: string,
  objectsByNum: Map<number, PdfObject>
): string | null {
  const ref = objectRef(body, key);
  if (ref !== null) return objectsByNum.get(ref)?.body ?? null;

  return inlineDictionaryValueBody(body, key);
}

function collectPageTreeRefs(
  rootRef: number,
  objectsByNum: Map<number, PdfObject>,
  maxDepth = 64
): number[] {
  const visited = new Set<number>();
  const leaves: number[] = [];

  const visit = (ref: number, depth: number): void => {
    if (depth > maxDepth || visited.has(ref)) return;
    visited.add(ref);

    const object = objectsByNum.get(ref);
    if (!object) return;

    if (/\/Type\s*\/?Page(?:[\s/]|$)/.test(object.body)) {
      leaves.push(ref);
      return;
    }

    const kids = objectRefs(object.body, "Kids");
    for (const childRef of kids) visit(childRef, depth + 1);
  };

  visit(rootRef, 0);
  return leaves;
}

function isCompletePageTree(
  treeRefs: number[],
  rawPageObjects: PdfObject[]
): boolean {
  if (treeRefs.length !== rawPageObjects.length) return false;

  const treeSet = new Set(treeRefs);
  if (treeSet.size !== treeRefs.length) return false;

  return rawPageObjects.every((page) => treeSet.has(page.num));
}

function buildFontMaps(
  pageObject: PdfObject,
  objectsByNum: Map<number, PdfObject>,
  budget: DecompressionBudget,
  cmapCache: Map<number, ToUnicodeMap | null>,
): FontMap {
  const resourcesBody = resolveInheritedDictionaryBody(
    pageObject,
    "Resources",
    objectsByNum
  );
  if (resourcesBody === null) return new Map();

  const fontDictionaryBody = dictionaryValueBody(
    resourcesBody,
    "Font",
    objectsByNum
  );
  if (fontDictionaryBody === null) return new Map();

  const fonts: FontMap = new Map();
  const fontEntryRe = /\/(F[A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g;
  let match: RegExpExecArray | null;

  while ((match = fontEntryRe.exec(fontDictionaryBody)) !== null) {
    const fontObject = objectsByNum.get(Number(match[2]));
    if (!fontObject) continue;

    const toUnicodeRef = objectRef(fontObject.body, "ToUnicode");
    if (toUnicodeRef === null) continue;

    let parsed = cmapCache.get(toUnicodeRef);
    if (parsed === undefined) {