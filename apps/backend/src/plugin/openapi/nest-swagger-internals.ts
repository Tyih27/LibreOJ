/**
 * The single point of coupling to `@nestjs/swagger`'s *internal* schema-generation services.
 *
 * `@nestjs/swagger@6` does not export `SchemaObjectFactory` (or its collaborators) from its public entry point, but the
 * backend's DTOs are compiled by `@nestjs/swagger/plugin` (see `apps/backend/nest-cli.json`, `classValidatorShim: true`)
 * so that every DTO carries a static `_OPENAPI_METADATA_FACTORY()` returning plain metadata. Feeding those classes
 * through these internal services is what lets {@link buildOpenApiDocument} reproduce, without a Nest application, the
 * exact schemas and path items `SwaggerModule.createDocument` produces today.
 *
 * The deep import paths are untyped by the package's public contract, and `@nestjs/swagger` will be removed in `M7.final`
 * — so keep every reference to them in this file, to make the dependency trivially vendorable or replaceable.
 */

export { ModelPropertiesAccessor } from "@nestjs/swagger/dist/services/model-properties-accessor";
export { ParametersMetadataMapper } from "@nestjs/swagger/dist/services/parameters-metadata-mapper";
export { SchemaObjectFactory } from "@nestjs/swagger/dist/services/schema-object-factory";
export { SwaggerTypesMapper } from "@nestjs/swagger/dist/services/swagger-types-mapper";

export type { ParamWithTypeMetadata, ParamsWithType } from "@nestjs/swagger/dist/services/parameter-metadata-accessor";
