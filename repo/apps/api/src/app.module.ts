import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { memoryStorage } from 'multer';
import { loadConfig, type AppConfig } from './config/app-config';
import { DatabaseModule } from './database/database.module';
import { FileUploadExceptionFilter } from './common/file-upload-exception.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import type { RequestWithContext } from './common/http';
import { SecurityModule } from './security/security.module';
import { AuditService } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { ProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';
import { CatalogResolver } from './catalog/catalog.resolver';
import { CatalogService } from './catalog/catalog.service';
import { CommunityController } from './community/community.controller';
import { CommunityService } from './community/community.service';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { ModerationController } from './moderation/moderation.controller';
import { ModerationService } from './moderation/moderation.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { RecommendationsResolver } from './recommendations/recommendations.resolver';
import { RecommendationsService } from './recommendations/recommendations.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: configService.get('evidenceUploadMaxBytes', { infer: true }),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: process.env.NODE_ENV === 'development',
      introspection: process.env.NODE_ENV === 'development',
      context: ({ req }: { req: RequestWithContext }) => ({ req }),
    }),
    DatabaseModule,
    SecurityModule,
    AuthModule,
  ],
  controllers: [
    ProfilesController,
    CommunityController,
    PosController,
    AttendanceController,
    ModerationController,
    AdminController,
  ],
  providers: [
    AuditService,
    ProfilesService,
    CatalogService,
    CatalogResolver,
    CommunityService,
    PosService,
    AttendanceService,
    ModerationService,
    AdminService,
    RecommendationsService,
    RecommendationsResolver,
    {
      provide: APP_FILTER,
      useClass: FileUploadExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
