import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './swagger.models';

@ApiTags('System')
@Controller()
export class HealthController {
  @Get('/health')
  @ApiOkResponse({ type: HealthResponseDto })
  public getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'document-parser-orchestrator-api',
      runtimeMode: this.resolveRuntimeMode(),
      timestamp: new Date().toISOString()
    };
  }

  private resolveRuntimeMode(): 'memory' | 'real' {
    const rawMode = (
      process.env.ORCHESTRATOR_RUNTIME_MODE ??
      process.env.DOCUMENT_PARSER_RUNTIME_MODE ??
      'memory'
    ).trim();

    return rawMode === 'real' ? 'real' : 'memory';
  }
}
