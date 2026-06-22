# 01 - Local Execution Test

This note contains code blocks that execute directly on your local system using local compiler paths.

## Python
```python
print("Hello from Python")
```

## JavaScript
```javascript
console.log("Hello from JavaScript");
```

## TypeScript
```typescript
const msg: string = "Hello from TypeScript";
console.log(msg);
```

## Shell
```sh
echo "Hello from Shell"
```

## Ruby
```ruby
puts "Hello from Ruby"
```

## Perl
```perl
print "Hello from Perl\n";
```

## Lua
```lua
print("Hello from Lua")
```

## PHP
```php
<?php
echo "Hello from PHP\n";
```

## Go
```go
package main
import "fmt"
func main() {
    fmt.Println("Hello from Go")
}
```

## Haskell
```haskell
main = putStrLn "Hello from Haskell"
```

## OCaml
```ocaml
print_endline "Hello from OCaml"
```

## C
```c
#include <stdio.h>
int main() {
    printf("Hello from C\n");
    return 0;
}
```

## C++
```cpp
#include <iostream>
int main() {
    std::cout << "Hello from C++" << std::endl;
    return 0;
}
```

## Rust
```rust
fn main() {
    println!("Hello from Rust");
}
```

## Java
```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java");
    }
}
```

## LLVM-IR
```llvm
; ModuleID = 'hello.ll'
declare i32 @puts(i8* nocapture) nounwind
@msg = private unnamed_addr constant [16 x i8] c"Hello from LLVM\00"
define i32 @main() {
    %1 = call i32 @puts(i8* getelementptr inbounds ([16 x i8], [16 x i8]* @msg, i32 0, i32 0))
    ret i32 0
}
```

## Lean
```lean
#eval "Hello from Lean"
```
