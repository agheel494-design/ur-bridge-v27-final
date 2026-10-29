import koffi from "koffi";
import type {
  IPlatformExecutor,
  NativeLibraryHandle,
  NativeCall,
  NativeCallResult,
  NativeArg,
  Platform,
} from "./types.js";

type LoadedLibrary = {
  library: ReturnType<typeof koffi.load>;
  functions: Map<string, (...args: unknown[]) => unknown>;
  unloaded: boolean;
};

function argumentType(arg: NativeArg): string {
  switch (arg.kind) {
    case "i32": return "int32_t";
    case "i64": return "int64_t";
    case "f64": return "double";
    case "str":
    case "null_str": return "const char *";
    case "ptr":
    case "null_ptr": return "void *";
  }
}

function returnType(kind: NativeCall["returnKind"]): string {
  switch (kind) {
    case "i32": return "int32_t";
    case "i64": return "int64_t";
    case "f64": return "double";
    case "str": return "const char *";
    case "ptr": return "void *";
    case "void": return "void";
    case "error": throw new Error('"error" is not a native return type');
  }
}

function convertArgument(arg: NativeArg): unknown {
  switch (arg.kind) {
    case "i32":
    case "i64":
    case "f64":
    case "str":
      return arg.value;
    case "null_str":
    case "null_ptr":
      return null;
    case "ptr":
      return koffi.as(arg.value, "void *");
  }
}

function convertResult(kind: NativeCall["returnKind"], value: unknown): NativeCallResult {
  switch (kind) {
    case "i32":
      return { kind, value: Number(value) };
    case "i64":
      return { kind, value: BigInt(value as bigint | number | string) };
    case "f64":
      return { kind, value: Number(value) };
    case "str":
      if (value == null) return { kind, value: "" };
      if (typeof value === "string") return { kind, value };
      if (Buffer.isBuffer(value)) {
        const end = value.indexOf(0);
        return { kind, value: value.subarray(0, end < 0 ? value.length : end).toString("utf8") };
      }
      return { kind, value: String(value) };
    case "ptr":
      if (value == null) return { kind, value: 0n };
      return {
        kind,
        value: typeof value === "bigint" ? value : koffi.address(value as Buffer),
      };
    case "void":
      return { kind: "void" };
    case "error":
      return { kind: "error", message: String(value) };
  }
}

export class WindowsExecutor implements IPlatformExecutor {
  readonly platform: Platform = "windows";

  load(libraryPath: string): NativeLibraryHandle {
    if (process.platform !== "win32") {
      throw new Error("WindowsExecutor requires a Windows runtime");
    }

    const library = koffi.load(libraryPath);
    const token: LoadedLibrary = {
      library,
      functions: new Map(),
      unloaded: false,
    };

    return { libraryPath, platform: this.platform, _token: token };
  }

  execute(handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    const token = this.getToken(handle);

    return calls.map((call) => {
      try {
        const argTypes = call.args.map(argumentType);
        const signature =
          `${returnType(call.returnKind)} ${call.symbol}(${argTypes.length ? argTypes.join(", ") : "void"})`;

        let fn = token.functions.get(signature);
        if (!fn) {
          fn = token.library.func(signature) as (...args: unknown[]) => unknown;
          token.functions.set(signature, fn);
        }

        const args = call.args.map(convertArgument);
        return convertResult(call.returnKind, fn(...args));
      } catch (error) {
        return {
          kind: "error",
          message: `${call.symbol}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
  }

  unload(handle: NativeLibraryHandle): void {
    if (handle.platform !== this.platform) {
      throw new Error(`Expected a Windows handle, received "${handle.platform}"`);
    }

    const token = handle._token as LoadedLibrary | undefined;
    if (!token || typeof token !== "object" || !token.library) {
      throw new Error("Invalid Windows native library handle");
    }
    if (token.unloaded) return;

    token.library.unload();
    token.unloaded = true;
    token.functions.clear();
  }

  private getToken(handle: NativeLibraryHandle): LoadedLibrary {
    if (handle.platform !== this.platform) {
      throw new Error(`Expected a Windows handle, received "${handle.platform}"`);
    }

    const token = handle._token as LoadedLibrary | undefined;
    if (!token || typeof token !== "object" || !token.library) {
      throw new Error("Invalid Windows native library handle");
    }
    if (token.unloaded) {
      throw new Error(`Native library has been unloaded: ${handle.libraryPath}`);
    }
    return token;
  }
}

