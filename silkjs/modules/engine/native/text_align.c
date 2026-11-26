/* A 16-byte block aligned to a 4 KiB page boundary placed right before
 * js_vm.executeLoop in startup.order, so executeLoop starts at +16 mod 4096
 * (and +16 mod 64) regardless of .rodata/.eh_frame size changes ahead of .text.
 * This keeps its 18-byte indirect-jump dispatch header (+0x130) at 0 mod 64
 * and locks its 4 KiB page/BTB/L1I-set offsets across unrelated edits, preventing
 * 15-35% microarchitectural swings (e.g. NavierStokes, Crypto, Richards, loops)
 * at identical instruction counts. Never called; retained against section GC. */
#if defined(__wasm__)
typedef int silkjs_text_align_unused;
#elif defined(__APPLE__)
__asm__(".section __TEXT,__text,regular,pure_instructions\n"
        ".p2align 12\n"
        ".globl _silkjs_text_align\n"
        ".no_dead_strip _silkjs_text_align\n"
        "_silkjs_text_align:\n"
        ".fill 16,1,0xcc\n"
        ".p2align 12\n"
        ".globl _silkjs_leaf_align\n"
        ".no_dead_strip _silkjs_leaf_align\n"
        "_silkjs_leaf_align:\n"
        ".fill 0x440,1,0xcc\n"
        ".p2align 6\n"
        ".globl _silkjs_hot_align\n"
        ".no_dead_strip _silkjs_hot_align\n"
        "_silkjs_hot_align:\n"
        ".fill 64,1,0xcc\n"
        ".text\n");
#elif defined(_WIN32)
__asm__(".section .text$silkjs_text_align,\"xr\"\n"
        ".p2align 12\n"
        ".globl silkjs_text_align\n"
        "silkjs_text_align:\n"
        ".fill 16,1,0xcc\n"
        ".section .text$silkjs_leaf_align,\"xr\"\n"
        ".p2align 12\n"
        ".globl silkjs_leaf_align\n"
        "silkjs_leaf_align:\n"
        ".fill 0x440,1,0xcc\n"
        ".section .text$silkjs_hot_align,\"xr\"\n"
        ".p2align 6\n"
        ".globl silkjs_hot_align\n"
        "silkjs_hot_align:\n"
        ".fill 64,1,0xcc\n"
        ".text\n");
#else
__asm__(".section .text.silkjs_text_align,\"axR\",@progbits\n"
        ".p2align 12\n"
        ".globl silkjs_text_align\n"
        ".type silkjs_text_align,@function\n"
        "silkjs_text_align:\n"
        ".fill 16,1,0xcc\n"
        ".size silkjs_text_align, 16\n"
        ".section .text.silkjs_leaf_align,\"axR\",@progbits\n"
        ".p2align 12\n"
        ".globl silkjs_leaf_align\n"
        ".type silkjs_leaf_align,@function\n"
        "silkjs_leaf_align:\n"
        ".fill 0x440,1,0xcc\n"
        ".size silkjs_leaf_align, 0x440\n"
        ".section .text.silkjs_hot_align,\"axR\",@progbits\n"
        ".p2align 6\n"
        ".globl silkjs_hot_align\n"
        ".type silkjs_hot_align,@function\n"
        "silkjs_hot_align:\n"
        ".fill 64,1,0xcc\n"
        ".size silkjs_hot_align, 64\n"
        ".text\n");
#endif
