"""Verify retained per-IP counts and x86-64 instruction bytes using GNU objdump."""

from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent


def disassemble(encodings):
    # Pack every distinct instruction with a trap delimiter. Relative branch
    # operands will change with relocation and are normalized below.
    blob = bytearray()
    offsets = {}
    for encoding in sorted(encodings):
        offsets[len(blob)] = encoding
        blob.extend(bytes.fromhex(encoding))
        blob.append(0xCC)
    with tempfile.NamedTemporaryFile() as file:
        file.write(blob)
        file.flush()
        lines = subprocess.check_output(
            ["objdump", "-D", "-b", "binary", "-m", "i386:x86-64",
             "-M", "intel", "--insn-width=15", file.name], text=True,
        ).splitlines()
    decoded = {}
    for line in lines:
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        address = int(parts[0].strip().rstrip(":"), 16)
        if address not in offsets:
            continue
        encoding = offsets[address]
        assert parts[1].replace(" ", "") == encoding
        decoded[encoding] = (address, parts[2])
    assert set(decoded) == encodings
    return decoded


def normalized(assembly, address):
    assembly = " ".join(assembly.partition("#")[0].split())
    branch = re.fullmatch(r"(j\w+|call) (0x[0-9a-f]+)", assembly)
    if branch:
        displacement = (int(branch[2], 16) - address) % (1 << 64)
        return branch[1], displacement
    return assembly


def main():
    receipt = json.loads((ROOT / "generated-ops.json").read_text())
    ledger = (ROOT / "generated-op-samples.json.gz").read_bytes()
    assert hashlib.sha256(ledger).hexdigest() == receipt["instruction_sample_ledger_sha256"]
    assert hashlib.sha256((ROOT / "receipt.json").read_bytes()).hexdigest() == receipt["underlying_native_sample_receipt_sha256"]
    archive = json.loads(gzip.decompress(ledger))
    windows = archive["windows"]
    columns = archive["columns"]
    encodings = {row[columns.index("bytes")] for rows in windows.values() for row in rows}
    decoded = disassemble(encodings)
    operations_total = Counter()
    sequences_total = Counter()
    kinds = Counter()
    bytecodes = Counter()
    for window in receipt["windows"]:
        operations = Counter()
        sequences = Counter()
        abi_stores = Counter()
        for values in windows[window["window"]]:
            row = dict(zip(columns, values, strict=True))
            count = row["samples"]
            address = row["block_offset"] + row["instruction_offset"]
            decoded_address, assembly = decoded[row["bytes"]]
            assert normalized(row["asm"], address) == normalized(assembly, decoded_address), row
            operations[row["operation"]] += count
            sequences[row["emitter_sequence"]] += count
            if row["abi_home_use"]:
                slot = row["stack_home"].split("#")[1]
                abi_stores[f'{row["abi_home_use"]} {slot}'] += count
            if window["window"].endswith("calls") and row["call_category"]:
                kinds[row["call_category"]] += count
                bytecodes[row["bytecode_opcode"] or "unmatched or ambiguous body"] += count
        assert operations == window["instruction_category"]
        assert sequences == window["emitter_sequence"]
        assert abi_stores == window["ABI_store_samples"]
        assert sum(operations.values()) == window["generated_samples"]
        if window["window"].endswith("calls"):
            operations_total.update(operations)
            sequences_total.update(sequences)
    totals = receipt["calls_on_totals"]
    assert operations_total == totals["instruction_categories"]
    assert sequences_total == totals["emitter_sequences"]
    assert kinds == totals["live_transfers_by_call_category"]
    assert bytecodes == totals["live_transfers_by_bytecode_opcode"]
    samples = sum(w["generated_samples"] for w in receipt["windows"])
    print(f"Verified {samples} samples across {len(windows)} windows, "
          f"{len(encodings)} distinct x86-64 encodings.")


if __name__ == "__main__":
    main()
