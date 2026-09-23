import { createMarkupSurfaceHostFacet } from "@hypit/hypit/author-kit";
import { h3ChainComponent, h3ChainDefinition, h3ChainManifest, h3ChainModuleRef,
  h3ChainTakeVideoDeclaration } from "./index.js";
import { decodeH3ChainTakeVideoSurface } from "./surface.js";

export const hypitPackage = { format: "hypit.node-package@1" as const, modules: [{ manifest: h3ChainManifest }], components: [h3ChainComponent], hostFacets: [
  h3ChainDefinition.hostFacet,
  createMarkupSurfaceHostFacet({
    module: h3ChainModuleRef,
    declaration: h3ChainTakeVideoDeclaration,
    handler: decodeH3ChainTakeVideoSurface,
  }),
] };
export default hypitPackage;
