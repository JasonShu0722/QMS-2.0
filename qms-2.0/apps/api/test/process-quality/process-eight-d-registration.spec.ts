import 'reflect-metadata';
import { AppModule } from '../../src/app.module.js';
import { ProcessQualityModule } from '../../src/modules/process-quality/process-quality.module.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessEightDController } from '../../src/modules/process-quality/process-eight-d.controller.js';
import { ProcessEightDClosureAdapter } from '../../src/modules/process-quality/process-eight-d-closure.adapter.js';
import { ProcessEightDReadAdapter } from '../../src/modules/process-quality/process-eight-d-read.adapter.js';
import { ProcessEightDFileAdapter } from '../../src/modules/process-quality/process-eight-d-file.adapter.js';
import { ProcessEightDReportService } from '../../src/modules/process-quality/process-eight-d-report.service.js';
import { ProcessEightDTaskService } from '../../src/modules/process-quality/process-eight-d-task.service.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { WorkflowModule } from '../../src/modules/workflow/workflow.module.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import { APPLICATION_OUTBOX_HANDLER } from '../../src/modules/task-notification/outbox-worker.service.js';

describe('production process 8D composition', () => {
  it('declares an unconfigured workflow binding as nullable in Swagger', () => {
    const response = Reflect.getMetadata('swagger/apiResponse', ProcessEightDController.prototype.binding);
    expect(response?.['200']?.schema?.nullable).toBe(true);
  });
  it.each(['analysis', 'submit'] as const)('returns the Swagger-declared 200 for %s', action => {
    expect(Reflect.getMetadata('__httpCode__', ProcessEightDController.prototype[action])).toBe(200);
  });
  it('registers the domain and each production adapter, report and task service', () => {
    const providers = Reflect.getMetadata('providers', ProcessQualityModule);
    for (const service of [ProcessEightDService, ProcessEightDClosureAdapter, ProcessEightDReadAdapter, ProcessEightDFileAdapter,
      ProcessEightDReportService, ProcessEightDTaskService, ProcessEightDReminderService]) expect(providers).toContain(service);
    expect(Reflect.getMetadata('exports', ProcessQualityModule)).toContain(ProcessEightDReminderService);
  });
  it('provides and exports the bounded workflow deadline service', () => {
    expect(Reflect.getMetadata('providers', WorkflowModule)).toContain(WorkflowDeadlineExtensionService);
    expect(Reflect.getMetadata('exports', WorkflowModule)).toContain(WorkflowDeadlineExtensionService);
  });
  it('connects process reminders to the real application outbox handler', () => {
    const provider = Reflect.getMetadata('providers', AppModule).find((entry: { provide?: unknown }) => entry.provide === APPLICATION_OUTBOX_HANDLER);
    expect(provider.inject).toContain(ProcessEightDReminderService);
  });
});
