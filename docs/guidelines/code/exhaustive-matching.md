# Exhaustive Matching

The goal is code understanding: a reader at a branch point sees every case the type allows, without opening the type. The branch itself documents the union.

When branching on a closed union in TypeScript (string-literal or discriminated), name every member and let the compiler check completeness. Use `match` from [`ts-pattern`](https://github.com/gvergnaud/ts-pattern): one `.with()` per member, closed with `.exhaustive(fallback)`.
