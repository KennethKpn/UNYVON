"use client";

import { useEffect, useRef } from "react";

interface CrowdCanvasProps {
  src?: string;
  rows?: number;
  cols?: number;
  className?: string;
}

type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Person = {
  sprite: SpriteRect;
  x: number;
  y: number;
  width: number;
  height: number;
  groundY: number;
  speed: number;
  direction: 1 | -1;
  phase: number;
  opacity: number;
};

const DEFAULT_SPRITE_SHEET = "https://skiper-ui.com/images/peeps/all-peeps.png";
const FALLBACK_SPRITE_SHEET =
  "https://s3-us-west-2.amazonaws.com/s.cdpn.io/175711/open-peeps-sheet.png";

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const shuffle = (values: number[]) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

export function CrowdCanvas({
  src = DEFAULT_SPRITE_SHEET,
  rows = 15,
  cols = 7,
  className = "block h-full w-full",
}: CrowdCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });

    if (!canvas || !context) return;

    const image = new Image();
    image.decoding = "async";

    let stageWidth = 0;
    let stageHeight = 0;
    let pixelRatio = 1;
    let imageReady = false;
    let imageFailed = false;
    let isInView = false;
    let pageIsVisible = document.visibilityState === "visible";
    let prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let animationFrame = 0;
    let previousTime = 0;
    let people: Person[] = [];
    let disposed = false;
    let sourceIndex = 0;
    const sources = [...new Set([src, DEFAULT_SPRITE_SHEET, FALLBACK_SPRITE_SHEET])];

    const clearCanvas = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, stageWidth, stageHeight);
    };

    const draw = (time: number) => {
      if (!imageReady || !stageWidth || !stageHeight) return;

      clearCanvas();

      [...people]
        .sort((first, second) => first.groundY - second.groundY)
        .forEach((person) => {
          const bob = prefersReducedMotion
            ? 0
            : Math.sin(time * 0.004 + person.phase) * 1.15;

          context.save();
          context.globalAlpha = person.opacity;

          if (person.direction === -1) {
            context.translate(person.x + person.width, person.y + bob);
            context.scale(-1, 1);
          } else {
            context.translate(person.x, person.y + bob);
          }

          context.drawImage(
            image,
            person.sprite.x,
            person.sprite.y,
            person.sprite.width,
            person.sprite.height,
            0,
            0,
            person.width,
            person.height,
          );

          context.restore();
        });
    };

    const createCrowd = () => {
      if (!imageReady || !stageWidth || !stageHeight) return;

      const cellWidth = image.naturalWidth / rows;
      const cellHeight = image.naturalHeight / cols;
      const sourceFrames = shuffle(
        Array.from({ length: rows * cols }, (_, index) => index),
      );

      // Density scales with viewport width: enough people to read as one crowd,
      // without turning the narrow mobile section into an unreadable black block.
      const count = Math.max(20, Math.min(74, Math.round(stageWidth / 16)));
      const slotWidth = stageWidth / count;

      people = Array.from({ length: count }, (_, index) => {
        const frameIndex = sourceFrames[index % sourceFrames.length];
        const sprite = {
          x: (frameIndex % rows) * cellWidth,
          y: Math.floor(frameIndex / rows) * cellHeight,
          width: cellWidth,
          height: cellHeight,
        };

        const depth = randomBetween(0, 1);
        const height = stageHeight * (0.48 + depth * 0.36);
        const width = height * (cellWidth / cellHeight);
        const groundY = stageHeight * (0.48 + depth * 0.54);
        const direction: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
        const centerX =
          slotWidth * (index + 0.5) +
          randomBetween(-slotWidth * 0.42, slotWidth * 0.42);

        return {
          sprite,
          x: centerX - width / 2,
          y: groundY - height,
          width,
          height,
          groundY,
          speed: randomBetween(12, 27),
          direction,
          phase: randomBetween(0, Math.PI * 2),
          opacity: randomBetween(0.82, 1),
        };
      });

      draw(0);
    };

    const resetPerson = (person: Person) => {
      person.direction = Math.random() > 0.5 ? 1 : -1;
      person.x =
        person.direction === 1
          ? -person.width - randomBetween(8, 45)
          : stageWidth + randomBetween(8, 45);
      person.speed = randomBetween(12, 27);
      person.phase = randomBetween(0, Math.PI * 2);
    };

    const stopAnimation = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      previousTime = 0;
    };

    const animate = (time: number) => {
      if (disposed) return;

      if (!previousTime) previousTime = time;
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;

      people.forEach((person) => {
        person.x += person.direction * person.speed * delta;

        if (
          (person.direction === 1 && person.x > stageWidth + person.width) ||
          (person.direction === -1 && person.x < -person.width)
        ) {
          resetPerson(person);
        }
      });

      draw(time);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const syncAnimation = () => {
      const shouldAnimate =
        imageReady &&
        isInView &&
        pageIsVisible &&
        !prefersReducedMotion;

      if (shouldAnimate && !animationFrame) {
        previousTime = 0;
        animationFrame = window.requestAnimationFrame(animate);
        return;
      }

      if (!shouldAnimate) {
        stopAnimation();
        if (imageReady) draw(0);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      stageWidth = bounds.width;
      stageHeight = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(stageWidth * pixelRatio);
      canvas.height = Math.round(stageHeight * pixelRatio);

      createCrowd();
      syncAnimation();
    };

    const handleVisibilityChange = () => {
      pageIsVisible = document.visibilityState === "visible";
      syncAnimation();
    };

    const motionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const handleMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      syncAnimation();
      draw(0);
    };

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              isInView = entry.isIntersecting;
              syncAnimation();
            },
            { rootMargin: "120px 0px", threshold: 0 },
          )
        : null;

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;

    intersectionObserver?.observe(canvas);
    isInView = intersectionObserver === null;
    resizeObserver?.observe(canvas);

    if (!resizeObserver) {
      window.addEventListener("resize", resize);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    motionQuery.addEventListener("change", handleMotionChange);

    image.onload = () => {
      if (disposed) return;
      imageReady = true;
      imageFailed = false;
      resize();
      syncAnimation();
    };

    image.onerror = () => {
      if (disposed) return;

      sourceIndex += 1;
      const nextSource = sources[sourceIndex];

      if (nextSource) {
        image.src = nextSource;
        return;
      }

      imageFailed = true;
      imageReady = false;
      stopAnimation();
      clearCanvas();
    };

    image.src = sources[sourceIndex];

    if (canvas.getBoundingClientRect().width) resize();

    return () => {
      disposed = true;
      stopAnimation();
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionQuery.removeEventListener("change", handleMotionChange);
      image.onload = null;
      image.onerror = null;
    };
  }, [cols, rows, src]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
    />
  );
}

export default CrowdCanvas;
