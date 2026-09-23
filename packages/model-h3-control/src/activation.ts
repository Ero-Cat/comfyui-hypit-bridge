import { createMarkupSurfaceHostFacet } from "@hypit/hypit/author-kit";
import { h3ControlComponent, h3ControlDeclaration, h3ControlDefinition, h3ControlManifest, h3ControlModuleRef } from "./index.js";
import { decodeH3ControlVideoSurface } from "./surface.js";

export const hypitPackage = { format: "hypit.node-package@1" as const, modules: [{ manifest: h3ControlManifest }], components: [h3ControlComponent], hostFacets: [
  h3ControlDefinition.hostFacet,
  createMarkupSurfaceHostFacet({
    module: h3ControlModuleRef,
    declaration: h3ControlDeclaration,
    handler: decodeH3ControlVideoSurface,
  }),
] };
export default hypitPackage;
