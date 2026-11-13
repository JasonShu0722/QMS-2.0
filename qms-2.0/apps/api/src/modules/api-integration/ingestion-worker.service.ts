import { Injectable } from '@nestjs/common';
import { IngestionService } from './ingestion.service.js';

@Injectable()
export class IngestionWorkerService {
  constructor(private readonly ingestion: IngestionService) {}
  processDue(limit = 100): Promise<number> { return this.ingestion.processDue(limit); }
}
