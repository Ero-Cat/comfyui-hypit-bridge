import { createMarkupSurfaceHostFacet } from "@hypit/hypit/author-kit";
import { h3UpscaleComponent, h3UpscaleDeclaration, h3UpscaleDefinition, h3UpscaleManifest, h3UpscaleModuleRef } from "./index.js";
import { decodeH3UpscaleSurface } from "./surface.js";

export const hypitPackage = { format: "hypit.node-package@1" as const, modules: [{ manifest: h3UpscaleManifest }], components: [h3UpscaleComponent], hostFacets: [
  h3UpscaleDefinition.hostFacet,
  createMarkupSurfaceHostFacet({
    module: h3UpscaleModuleRef,
    declaration: h3UpscaleDeclaration,
    handler: decodeH3UpscaleSurface,
  }),
] };
export default hypitPackage;
