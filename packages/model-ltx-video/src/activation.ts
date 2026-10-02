import { createMarkupSurfaceHostFacet } from "@hypit/hypit/author-kit";
import { ltxVideoComponent, ltxVideoDefinition, ltxVideoManifest, ltxVideoModuleRef,
  ltxGenVideoDeclaration } from "./index.js";
import { decodeLtxGenVideoSurface } from "./surface.js";

export const hypitPackage = { format: "hypit.node-package@1" as const, modules: [{ manifest: ltxVideoManifest }], components: [ltxVideoComponent], hostFacets: [
  ltxVideoDefinition.hostFacet,
  createMarkupSurfaceHostFacet({
    module: ltxVideoModuleRef,
    declaration: ltxGenVideoDeclaration,
    handler: decodeLtxGenVideoSurface,
  }),
] };
export default hypitPackage;
