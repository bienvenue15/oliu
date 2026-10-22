# Documentation

- `slices/` — one note per roadmap slice, written for the owner after the slice is built:
  what exists, how it works, how to try it, what was tested, what was left out, questions.
  Read in order they are the handover manual. Each note is Markdown (read it on GitHub)
  with a PDF beside it to open offline; `npm run docs:pdf` rebuilds the PDFs.
- Module READMEs live next to the code: `api/src/modules/<module>/README.md`.
- The design inputs (analysis, proposal, mockups, roadmap, data model) are in `../documents/`.

| Slice | Note | State |
|---|---|---|
| 1 | [Accounts, companies, roles](slices/01-accounts-companies-roles.md) · [PDF](slices/01-accounts-companies-roles.pdf) | built, awaiting live test |
| 2 | Booking and container | next |
