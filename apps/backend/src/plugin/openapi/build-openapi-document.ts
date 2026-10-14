import type { HttpRouteSpec } from "@libreoj/plugin-api";

import {
  ModelPropertiesAccessor,
  ParametersMetadataMapper,
  SchemaObjectFactory,
  SwaggerTypesMapper,
  type ParamWithTypeMetadata,
  type ParamsWithType
} from "./nest-swagger-internals";

/** Configuration for {@link buildOpenApiDocument}, mirroring the `DocumentBuilder` the backend used to build. */
export interface OpenApiDocumentConfig {
  title: string;
  description: string;
  version: string;
  /**
   * Path prefix every route is mounted under. The backend serves under `"api"`, which is why the generated document's
   * `paths` keys start with `/api/` (the frontend generator strips that prefix). Pass `""` for no prefix.
   */
  globalPrefix?: string;
  /** Emit the `bearer` security scheme and per-operation `security`, i.e. `DocumentBuilder().addBearerAuth()`. */
  bearerAuth?: boolean;
}

/** A parameter as `SwaggerTypesMapper.mapParamTypes` emits it. Kept loose because the internal return type is a union. */
export interface OpenApiParameter {
  in?: string;
  name?: unknown;
  required?: boolean;
  schema?: unknown;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
  security?: Array<Record<string, unknown[]>>;
}

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  tags: unknown[];
  servers: unknown[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes?: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
}

const JSON_MIME_TYPE = "application/json";
const SCHEMA_REF_PREFIX = "#/components/schemas/";

/**
 * Reproduces the pipeline `@nestjs/swagger`'s `api-parameters.explorer` runs for `@Query()`/`@Param()`/`@Body()`
 * parameters: expand a DTO into its properties (for query/path) or into a `$ref` (for the body), then post-process the
 * parameter list. The body entry is split out into a request body, exactly as `migrateOperationSchema` does.
 */
function buildParameters(
  route: HttpRouteSpec,
  parametersMetadataMapper: ParametersMetadataMapper,
  schemaObjectFactory: SchemaObjectFactory,
  swaggerTypesMapper: SwaggerTypesMapper,
  schemas: Record<string, unknown>
): { parameters: OpenApiParameter[]; requestBody?: OpenApiOperation["requestBody"] } {
  const request = route.request ?? {};
  const model: ParamsWithType = {};
  let index = 0;
  const add = (parameterIn: string, type: unknown): void => {
    if (!type) return;
    model[String(index)] = {
      type: type as NonNullable<ParamWithTypeMetadata["type"]>,
      required: true,
      in: parameterIn as ParamWithTypeMetadata["in"]
    };
    index += 1;
  };
  add("path", request.params);
  add("query", request.query);
  add("body", request.body);

  if (index === 0) return { parameters: [] };

  const properties = parametersMetadataMapper.transformModelToProperties(model);
  const mapped = swaggerTypesMapper.mapParamTypes(
    schemaObjectFactory.createFromModel(properties, schemas)
  ) as unknown as OpenApiParameter[];

  const parameters: OpenApiParameter[] = [];
  let requestBody: OpenApiOperation["requestBody"];
  for (const parameter of mapped) {
    if (parameter.in === "body") {
      requestBody = {
        required: parameter.required ?? true,
        content: { [JSON_MIME_TYPE]: { schema: parameter.schema } }
      };
    } else {
      parameters.push(parameter);
    }
  }
  return { parameters, requestBody };
}

function buildResponses(
  route: HttpRouteSpec,
  schemaObjectFactory: SchemaObjectFactory,
  schemas: Record<string, unknown>
): Record<string, unknown> {
  const status = route.method === "POST" ? "201" : "200";
  if (!route.response) return { [status]: { description: "" } };

  const name = schemaObjectFactory.exploreModelSchema(
    route.response as NonNullable<ParamWithTypeMetadata["type"]>,
    schemas
  );
  return {
    [status]: {
      description: "",
      content: { [JSON_MIME_TYPE]: { schema: { $ref: `${SCHEMA_REF_PREFIX}${name}` } } }
    }
  };
}

function buildOperation(
  route: HttpRouteSpec,
  schemaObjectFactory: SchemaObjectFactory,
  parametersMetadataMapper: ParametersMetadataMapper,
  swaggerTypesMapper: SwaggerTypesMapper,
  schemas: Record<string, unknown>
): OpenApiOperation {
  const { parameters, requestBody } = buildParameters(
    route,
    parametersMetadataMapper,
    schemaObjectFactory,
    swaggerTypesMapper,
    schemas
  );

  const operation: OpenApiOperation = {
    parameters,
    responses: buildResponses(route, schemaObjectFactory, schemas),
    tags: route.tags ?? []
  };
  if (route.operationId) operation.operationId = route.operationId;
  if (route.summary) operation.summary = route.summary;
  if (requestBody) operation.requestBody = requestBody;
  if (route.auth) operation.security = [{ bearer: [] }];
  return operation;
}

/**
 * Builds an OpenAPI 3.0 document from provider-agnostic {@link HttpRouteSpec}s, without a Nest application.
 *
 * DTO schemas come from `@nestjs/swagger`'s internal `SchemaObjectFactory`, which reads the static
 * `_OPENAPI_METADATA_FACTORY()` that the swagger build plugin emits on every DTO — so the result matches what
 * `SwaggerModule.createDocument` produces for the equivalent Nest controller (see `nest-swagger-internals.ts`). Query
 * and path DTOs are flattened into individual parameters; a body DTO becomes `requestBody.content`; the response DTO
 * becomes `responses[status].content`. The `2xx` status is `201` for `POST` and `200` otherwise, matching Nest's
 * default success code (the homepage controller sets no explicit `@HttpCode`).
 *
 * This is transitional: the coupling to `@nestjs/swagger` lives only in `nest-swagger-internals.ts`, and the whole
 * module becomes provider-agnostic once that dependency is replaced in `M7.final`.
 */
export function buildOpenApiDocument(routes: HttpRouteSpec[], config: OpenApiDocumentConfig): OpenApiDocument {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  const modelPropertiesAccessor = new ModelPropertiesAccessor();
  const swaggerTypesMapper = new SwaggerTypesMapper();
  const schemaObjectFactory = new SchemaObjectFactory(modelPropertiesAccessor, swaggerTypesMapper);
  const parametersMetadataMapper = new ParametersMetadataMapper(modelPropertiesAccessor);

  const globalPrefix = config.globalPrefix ?? "api";
  const bearerAuth = config.bearerAuth ?? true;

  for (const route of routes) {
    const operation = buildOperation(route, schemaObjectFactory, parametersMetadataMapper, swaggerTypesMapper, schemas);
    const routePath = route.path.startsWith("/") ? route.path : `/${route.path}`;
    const fullPath = globalPrefix ? `/${globalPrefix}${routePath}` : routePath;

    paths[fullPath] = { ...(paths[fullPath] ?? {}), [route.method.toLowerCase()]: operation };
  }

  const components: OpenApiDocument["components"] = { schemas };
  if (bearerAuth) components.securitySchemes = { bearer: { scheme: "bearer", bearerFormat: "JWT", type: "http" } };

  return {
    openapi: "3.0.0",
    info: { title: config.title, description: config.description, version: config.version, contact: {} },
    tags: [],
    servers: [],
    paths,
    components
  };
}
