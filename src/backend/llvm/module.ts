// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Module Assembly Helper
// ─────────────────────────────────────────────────────────────────────────────

import type { LLVMBasicBlock, LLVMFunction, LLVMModule } from "./types.js";

export class LLVMFunctionAssembler {
  private readonly blocks: LLVMBasicBlock[] = [];

  constructor(private readonly name: string, private readonly returnType: LLVMFunction["returnType"], private readonly params: LLVMFunction["params"]) {}

  addBlock(block: LLVMBasicBlock): void {
    this.blocks.push(block);
  }

  finish(): LLVMFunction {
    return { name: this.name, returnType: this.returnType, params: this.params, blocks: this.blocks };
  }
}

export class LLVMModuleAssembler {
  private readonly functions: LLVMFunction[] = [];

  addFunction(fn: LLVMFunction): void {
    this.functions.push(fn);
  }

  finish(): LLVMModule {
    return { functions: this.functions };
  }
}
