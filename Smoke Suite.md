# Smoke Suite

## Inline Python

```python loom-smoke-name=python-inline loom-smoke-profiles=minimal loom-smoke-stdout=42
print(40 + 2)
```

## Shell

```shell loom-smoke-name=shell-inline loom-smoke-profiles=minimal,systems loom-smoke-stdout=loom-shell
echo loom-shell
```

## Standard input

```python loom-smoke-name=stdin-inline loom-smoke-profiles=minimal loom-stdin="alpha\nbeta" loom-smoke-stdout=alpha|beta
import sys

print("|".join(line.strip() for line in sys.stdin))
```

## C

```c loom-smoke-name=c-native loom-smoke-profiles=systems loom-smoke-stdout=21
#include <stdio.h>

int main(void) {
  printf("%d\n", 7 * 3);
  return 0;
}
```

## Python source extraction

```python loom-smoke-name=python-extract loom-smoke-profiles=minimal loom-file="code/python_source.py" loom-symbol=weighted_root loom-call=true loom-smoke-stdout=15.0
25
```

## Working directory override

```python loom-smoke-name=cwd-override loom-smoke-profiles=minimal loom-cwd="fixtures" loom-smoke-stdout=from-fixture
from pathlib import Path
print(Path("message.txt").read_text().strip())
```

## SMT proof path

```smtlib loom-smoke-name=smtlib-basic loom-smoke-profiles=proofs loom-smoke=skip-missing loom-smoke-stdout-contains=sat
(set-logic QF_LIA)
(declare-const x Int)
(assert (= x 7))
(check-sat)
```

## eBPF C compile

```ebpf-c loom-smoke-name=ebpf-compile loom-smoke-profiles=ebpf loom-smoke-stdout-contains=xdp loom-smoke=skip-missing
#define SEC(NAME) __attribute__((section(NAME), used))

typedef unsigned int __u32;

struct xdp_md {
    __u32 data;
    __u32 data_end;
};

SEC("xdp")
int xdp_pass(struct xdp_md *ctx) {
    return 2;
}

char _license[] SEC("license") = "GPL";
```

## bpftrace dry run

```bpftrace loom-smoke-name=bpftrace-check loom-smoke-profiles=ebpf loom-smoke=skip-missing
BEGIN
{
  printf("loom bpftrace check\n");
  exit();
}
```

## Kernel load guard

```ebpf-c loom-smoke-name=ebpf-load-guard loom-smoke-profiles=ebpf loom-smoke=expect-fail loom-smoke-stderr-contains="kernel loading is disabled" loom-ebpf-mode=load loom-ebpf-pin=/sys/fs/bpf/loom_xdp
#define SEC(NAME) __attribute__((section(NAME), used))

typedef unsigned int __u32;

struct xdp_md {
    __u32 data;
    __u32 data_end;
};

SEC("xdp")
int xdp_pass(struct xdp_md *ctx) {
    return 2;
}

char _license[] SEC("license") = "GPL";
```
