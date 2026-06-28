import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonFileError extends Error {
  readonly path: string;
  readonly cause?: unknown;

  constructor(message: string, path: string, cause?: unknown) {
    super(message);
    this.name = "JsonFileError";
    this.path = path;
    this.cause = cause;
  }
}

export async function readJsonFile<T>(path: string, defaultValue: T): Promise<T> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaultValue;
    }
    throw new JsonFileError(`Unable to read JSON file: ${path}`, path, error);
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new JsonFileError(`Unable to parse JSON file: ${path}`, path, error);
  }
}

export async function writeJsonFileAtomic<T>(path: string, data: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    throw new JsonFileError(`Unable to write JSON file atomically: ${path}`, path, error);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
