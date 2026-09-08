import { ResolvedFile } from "../modResolution/resolver";

/** Where a merged value actually came from - enough to build an LSP go-to-definition Location, loose file or inside a VP. */
export interface SourceLocation {
  resolved: ResolvedFile;
  line: number;
}
