import { DocumentBuilder, type OpenAPIObject, type SwaggerDocumentOptions } from '@nestjs/swagger';

export function buildOpenApiConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('SaaS Skeleton Platform API')
    .setDescription('Control plane: tenants CRUD, queue monitoring, platform operators')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
}

// platformAuthLogin, tenantsFindAll, ... — та сама фабрика, що в tenant-api
export const openApiDocumentOptions: SwaggerDocumentOptions = {
  operationIdFactory: (controllerKey: string, methodKey: string): string => {
    const prefix = controllerKey.replace(/Controller$/, '');
    return (
      prefix.charAt(0).toLowerCase() +
      prefix.slice(1) +
      methodKey.charAt(0).toUpperCase() +
      methodKey.slice(1)
    );
  },
};
