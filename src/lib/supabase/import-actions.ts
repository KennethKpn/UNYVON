"use server";

import { randomUUID } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveMemberOrg, resolveOwnedOrg } from "@/lib/supabase/org-resolve";
import {
  addImportDocumentSchema,
  buildImportStoragePath,
  canTransitionImportDocument,
  importFieldsSchema,
  canTransitionImportSession,
  importStoragePathSchema,
  uuidSchema,
} from "@/lib/import/schemas";
import {
  IMPORT_TARGET_FIELDS,
  type DatabaseImportDocument,
  type DatabaseImportSession,
  type DatabaseImportItem,
  type ImportDocumentState,
  type ImportFieldProvenance,
} from "@/lib/import/types";
import {
  createDefaultProvider,
  createDocumentExtractor,
  type ExtractedDocument,
} from "@/lib/import/extraction";
import type { z } from "zod";
import { proposeImportItemMatch, type ExistingImportEntity } from "@/lib/import/matching";
