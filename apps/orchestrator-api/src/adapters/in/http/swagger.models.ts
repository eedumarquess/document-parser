import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HttpErrorResponseDto {
  @ApiProperty()
  public errorCode!: string;

  @ApiProperty()
  public message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public metadata?: Record<string, unknown>;
}

export class JobResponseDto {
  @ApiProperty()
  public jobId!: string;

  @ApiProperty()
  public documentId!: string;

  @ApiProperty()
  public status!: string;

  @ApiProperty()
  public requestedMode!: string;

  @ApiProperty()
  public pipelineVersion!: string;

  @ApiProperty()
  public outputVersion!: string;

  @ApiProperty()
  public reusedResult!: boolean;

  @ApiProperty()
  public createdAt!: string;
}

export class ResultResponseDto {
  @ApiProperty()
  public jobId!: string;

  @ApiProperty()
  public documentId!: string;

  @ApiProperty()
  public status!: string;

  @ApiProperty()
  public requestedMode!: string;

  @ApiProperty()
  public pipelineVersion!: string;

  @ApiProperty()
  public outputVersion!: string;

  @ApiProperty()
  public confidence!: number;

  @ApiProperty({ type: [String] })
  public warnings!: string[];

  @ApiProperty()
  public payload!: string;
}

export class JobOperationalSummaryResponseDto {
  @ApiProperty()
  public jobId!: string;

  @ApiProperty()
  public documentId!: string;

  @ApiProperty()
  public status!: string;

  @ApiProperty()
  public requestedMode!: string;

  @ApiProperty()
  public priority!: string;

  @ApiProperty()
  public queueName!: string;

  @ApiProperty()
  public pipelineVersion!: string;

  @ApiProperty()
  public outputVersion!: string;

  @ApiProperty()
  public reusedResult!: boolean;

  @ApiProperty()
  public forceReprocess!: boolean;

  @ApiProperty({ type: [String] })
  public warnings!: string[];

  @ApiPropertyOptional()
  public errorCode?: string;

  @ApiPropertyOptional()
  public errorMessage?: string;

  @ApiProperty()
  public acceptedAt!: string;

  @ApiPropertyOptional()
  public queuedAt?: string;

  @ApiPropertyOptional()
  public startedAt?: string;

  @ApiPropertyOptional()
  public finishedAt?: string;

  @ApiProperty()
  public createdAt!: string;

  @ApiProperty()
  public updatedAt!: string;
}

export class JobAttemptOperationalResponseDto {
  @ApiProperty()
  public attemptId!: string;

  @ApiProperty()
  public attemptNumber!: number;

  @ApiProperty()
  public status!: string;

  @ApiProperty()
  public pipelineVersion!: string;

  @ApiProperty()
  public fallbackUsed!: boolean;

  @ApiPropertyOptional()
  public fallbackReason?: string;

  @ApiPropertyOptional()
  public promptVersion?: string;

  @ApiPropertyOptional()
  public modelVersion?: string;

  @ApiPropertyOptional()
  public normalizationVersion?: string;

  @ApiPropertyOptional()
  public latencyMs?: number;

  @ApiPropertyOptional()
  public errorCode?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public errorDetails?: Record<string, unknown>;

  @ApiPropertyOptional()
  public startedAt?: string;

  @ApiPropertyOptional()
  public finishedAt?: string;

  @ApiProperty()
  public createdAt!: string;
}

export class ProcessingResultOperationalResponseDto extends ResultResponseDto {
  @ApiProperty()
  public engineUsed!: string;

  @ApiProperty()
  public totalLatencyMs!: number;

  @ApiPropertyOptional()
  public promptVersion?: string;

  @ApiPropertyOptional()
  public modelVersion?: string;

  @ApiPropertyOptional()
  public normalizationVersion?: string;

  @ApiProperty()
  public createdAt!: string;

  @ApiProperty()
  public updatedAt!: string;
}

export class AuditActorDto {
  @ApiProperty()
  public actorId!: string;

  @ApiProperty()
  public role!: string;
}

export class AuditEventOperationalResponseDto {
  @ApiProperty()
  public eventId!: string;

  @ApiProperty()
  public eventType!: string;

  @ApiPropertyOptional()
  public aggregateType?: string;

  @ApiPropertyOptional()
  public aggregateId?: string;

  @ApiProperty()
  public traceId!: string;

  @ApiProperty({ type: AuditActorDto })
  public actor!: AuditActorDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public redactedPayload?: Record<string, unknown>;

  @ApiProperty()
  public createdAt!: string;
}

export class DeadLetterOperationalResponseDto {
  @ApiProperty()
  public dlqEventId!: string;

  @ApiPropertyOptional()
  public jobId?: string;

  @ApiPropertyOptional()
  public attemptId?: string;

  @ApiProperty()
  public traceId!: string;

  @ApiProperty()
  public queueName!: string;

  @ApiProperty()
  public reasonCode!: string;

  @ApiProperty()
  public reasonMessage!: string;

  @ApiProperty()
  public retryCount!: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public payloadSnapshot?: Record<string, unknown>;

  @ApiProperty()
  public firstSeenAt!: string;

  @ApiProperty()
  public lastSeenAt!: string;

  @ApiPropertyOptional()
  public replayedAt?: string;
}

export class ArtifactOperationalResponseDto {
  @ApiProperty()
  public artifactId!: string;

  @ApiProperty()
  public artifactType!: string;

  @ApiPropertyOptional()
  public pageNumber?: number;

  @ApiProperty()
  public mimeType!: string;

  @ApiProperty()
  public storageBucket!: string;

  @ApiProperty()
  public storageObjectKey!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  public previewText?: string;

  @ApiProperty()
  public createdAt!: string;

  @ApiProperty()
  public retentionUntil!: string;
}

export class QueuePublicationOperationalResponseDto {
  @ApiProperty()
  public outboxId!: string;

  @ApiProperty()
  public status!: string;

  @ApiProperty()
  public ownerService!: string;

  @ApiProperty()
  public flowType!: string;

  @ApiProperty()
  public dispatchKind!: string;

  @ApiProperty()
  public queueName!: string;

  @ApiProperty()
  public attemptId!: string;

  @ApiPropertyOptional()
  public retryAttempt?: number;

  @ApiProperty()
  public publishAttempts!: number;

  @ApiProperty()
  public availableAt!: string;

  @ApiPropertyOptional()
  public lastError?: string;

  @ApiPropertyOptional()
  public publishedAt?: string;

  @ApiProperty()
  public updatedAt!: string;

  @ApiProperty()
  public createdAt!: string;
}

export class TelemetryEventOperationalResponseDto {
  @ApiProperty()
  public telemetryEventId!: string;

  @ApiProperty()
  public kind!: string;

  @ApiProperty()
  public serviceName!: string;

  @ApiPropertyOptional()
  public traceId?: string;

  @ApiPropertyOptional()
  public jobId?: string;

  @ApiPropertyOptional()
  public documentId?: string;

  @ApiPropertyOptional()
  public attemptId?: string;

  @ApiPropertyOptional()
  public operation?: string;

  @ApiProperty()
  public occurredAt!: string;

  @ApiPropertyOptional()
  public level?: string;

  @ApiPropertyOptional()
  public message?: string;

  @ApiPropertyOptional()
  public context?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public data?: Record<string, unknown>;

  @ApiPropertyOptional()
  public metricKind?: string;

  @ApiPropertyOptional()
  public name?: string;

  @ApiPropertyOptional()
  public value?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public tags?: Record<string, string>;

  @ApiPropertyOptional()
  public spanName?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true
  })
  public attributes?: Record<string, unknown>;

  @ApiPropertyOptional()
  public startedAt?: string;

  @ApiPropertyOptional()
  public endedAt?: string;

  @ApiPropertyOptional()
  public status?: string;

  @ApiPropertyOptional()
  public errorMessage?: string;
}

export class JobTimelineItemResponseDto {
  @ApiProperty()
  public source!: string;

  @ApiProperty()
  public occurredAt!: string;

  @ApiProperty()
  public title!: string;

  @ApiProperty()
  public detail!: string;

  @ApiPropertyOptional()
  public traceId?: string;

  @ApiPropertyOptional()
  public attemptId?: string;

  @ApiPropertyOptional()
  public serviceName?: string;
}

export class JobOperationalContextResponseDto {
  @ApiProperty({ type: JobOperationalSummaryResponseDto })
  public summary!: JobOperationalSummaryResponseDto;

  @ApiProperty({ type: [JobAttemptOperationalResponseDto] })
  public attempts!: JobAttemptOperationalResponseDto[];

  @ApiPropertyOptional({ type: ProcessingResultOperationalResponseDto })
  public result?: ProcessingResultOperationalResponseDto;

  @ApiPropertyOptional({ type: QueuePublicationOperationalResponseDto })
  public queuePublication?: QueuePublicationOperationalResponseDto;

  @ApiProperty({ type: [AuditEventOperationalResponseDto] })
  public auditEvents!: AuditEventOperationalResponseDto[];

  @ApiProperty({ type: [DeadLetterOperationalResponseDto] })
  public deadLetters!: DeadLetterOperationalResponseDto[];

  @ApiProperty({ type: [ArtifactOperationalResponseDto] })
  public artifacts!: ArtifactOperationalResponseDto[];

  @ApiProperty({ type: [TelemetryEventOperationalResponseDto] })
  public telemetryEvents!: TelemetryEventOperationalResponseDto[];

  @ApiProperty({ type: [String] })
  public traceIds!: string[];

  @ApiProperty({ type: [JobTimelineItemResponseDto] })
  public timeline!: JobTimelineItemResponseDto[];
}

export class ReprocessRequestDto {
  @ApiPropertyOptional()
  public reason?: string;
}

export class ReplayDeadLetterRequestDto {
  @ApiPropertyOptional()
  public reason?: string;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  public status!: 'ok';

  @ApiProperty({ example: 'document-parser-orchestrator-api' })
  public service!: string;

  @ApiProperty({ example: 'memory' })
  public runtimeMode!: 'memory' | 'real';

  @ApiProperty()
  public timestamp!: string;
}

export class SubmitAndWaitResponseDto {
  @ApiProperty({ type: JobResponseDto })
  public job!: JobResponseDto;

  @ApiProperty({ type: ResultResponseDto })
  public result!: ResultResponseDto;
}
