I want to cleanup my code before I push it out for review. Please audit everything from a more wholistic high level point of view to make sure the design and decisions are correct. Feel free to use online reference to decide what is "correct" and "standard." Some things to look out for.

1. remove dead code. Make sure there's nothing being declared that isn't used.

2. Make sure all functions have comments and there are also comments on confusing lines / not normal things we had to work around.

3. This needs to be human readable. Err on simplicity, don't have many layers of complex ternary logic which may make sense to you but not to a human. Prefer even duplications sometimes and longer declarations if it means it's much more readable.

4. Make sure no memory leeks. When something is deleted, make sure it's deleted from the database. I don't want forever climbing disk usage. Make sure API calls are optimized. For example, if 2 calls are only ever called together, why make them separate API calls?

5. See if things can be sped up, maybe there is duplication in mounting or API queries etc other optimizations. We want our application to be a super smooth user experience.
