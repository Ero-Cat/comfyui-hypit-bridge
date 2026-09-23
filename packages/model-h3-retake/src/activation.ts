import { createMarkupSurfaceHostFacet } from "@hypit/hypit/author-kit";
import { h3RetakeComponent, h3RetakeDeclaration, h3RetakeDefinition, h3RetakeManifest, h3RetakeModuleRef } from "./index.js";
import { decodeH3RetakeSurface } from "./surface.js";

export const hypitPackage = { format: "hypit.node-package@1" as const, modules: [{ manifest: h3RetakeManifest }], components: [h3RetakeComponent], hostFacets: [
  h3RetakeDefinition.hostFacet,
  createMarkupSurfaceHostFacet({
    module: h3RetakeModuleRef,
    declaration: h3RetakeDeclaration,
    handler: decodeH3RetakeSurface,
  }),
] };
export default hypitPackage;
