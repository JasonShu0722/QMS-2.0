import type { Prisma } from '../../generated/prisma/client.js';
import { ProcessEightDService } from '../../modules/process-quality/process-eight-d.service.js';
import type { ProcessEightDActor } from '../../modules/process-quality/process-eight-d.types.js';
import type { ProcessEightDReportDto, ProcessEightDSourcePreviewDto } from '../../modules/process-quality/process-eight-d.dto.js';
import type { WorkflowClosureContext } from '../../modules/workflow/workflow-closure-round.types.js';
import { INTERNAL_EIGHT_D_DOMAINS } from './internal-eight-d-domain.js';
import type { InternalEightDHttpIssueDto, InternalEightDHttpReportDto, InternalEightDHttpSourceConfirmationDto,
  InternalEightDHttpSourceDto, InternalEightDHttpSourcePreviewInputDto, InternalEightDHttpSourcesDto } from './internal-eight-d-http.dto.js';

type CoreDependencies = ConstructorParameters<typeof ProcessEightDService>;
export type InternalEightDHttpCoreDependencies = [
  prisma: CoreDependencies[0], source: CoreDependencies[1], domainIssues: CoreDependencies[2], links: CoreDependencies[3],
  runtime: CoreDependencies[4], problems: CoreDependencies[5], rounds: CoreDependencies[6], responsibilities: CoreDependencies[7],
  resources: CoreDependencies[8], audit: CoreDependencies[9], outbox: CoreDependencies[10], readRegistry: CoreDependencies[11], extensions: CoreDependencies[12],
];

export function createCustomerEightDCore(...dependencies: InternalEightDHttpCoreDependencies): ProcessEightDService {
  return new ProcessEightDService(...dependencies, INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
}

export function createNewProductEightDCore(...dependencies: InternalEightDHttpCoreDependencies): ProcessEightDService {
  return new ProcessEightDService(...dependencies, INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT);
}

const toCoreSource = ({ sourceId, ...source }: InternalEightDHttpSourceDto) => ({ ...source, defectId: sourceId });
const toCoreConfirmation = ({ sourceId, ...confirmation }: InternalEightDHttpSourceConfirmationDto) => ({ ...confirmation, defectId: sourceId });

export function toCoreEightDIssue({ sources, sourceConfirmations, ...input }: InternalEightDHttpIssueDto) {
  return { ...input, sources: sources.map(toCoreSource), ...(sourceConfirmations == null ? {} : { sourceConfirmations: sourceConfirmations.map(toCoreConfirmation) }) };
}

export function toCoreEightDPreview({ sources, ...input }: InternalEightDHttpSourcePreviewInputDto) {
  return { ...input, sources: sources.map(toCoreSource) };
}

export function toCoreEightDSources({ add, removeSourceIds, primarySourceId, sourceConfirmations, ...input }: InternalEightDHttpSourcesDto) {
  return { ...input, add: add.map(toCoreSource), removeDefectIds: removeSourceIds,
    ...(primarySourceId === undefined ? {} : { primaryDefectId: primarySourceId }),
    ...(sourceConfirmations == null ? {} : { sourceConfirmations: sourceConfirmations.map(toCoreConfirmation) }) };
}

export function toHttpEightDPreview({ defectId, ...preview }: ProcessEightDSourcePreviewDto) {
  return { ...preview, sourceId: defectId };
}

export function toHttpEightDReport(model: unknown): InternalEightDHttpReportDto {
  // Mutation replays return the same model as JSON; evidence snapshots stay verbatim.
  const report = model as ProcessEightDReportDto;
  return { ...report, sources: report.sources.map(({ defectId, ...source }) => ({ ...source, sourceId: defectId })) };
}

export class InternalEightDHttpService {
  constructor(readonly core: ProcessEightDService) {}

  binding(...args: Parameters<ProcessEightDService['binding']>) { return this.core.binding(...args); }
  bind(...args: Parameters<ProcessEightDService['bind']>) { return this.core.bind(...args); }
  activate(...args: Parameters<ProcessEightDService['activate']>) { return this.core.activate(...args); }
  assignmentOptions(...args: Parameters<ProcessEightDService['assignmentOptions']>) { return this.core.assignmentOptions(...args); }
  issue(actor: ProcessEightDActor, input: InternalEightDHttpIssueDto, traceId: string, key: string) { return this.core.issue(actor, toCoreEightDIssue(input), traceId, key); }
  async previewSources(actor: ProcessEightDActor, input: InternalEightDHttpSourcePreviewInputDto) { return (await this.core.previewSources(actor, toCoreEightDPreview(input))).map(toHttpEightDPreview); }
  async read(...args: Parameters<ProcessEightDService['read']>) { return toHttpEightDReport(await this.core.read(...args)); }
  async save(...args: Parameters<ProcessEightDService['save']>) { return toHttpEightDReport(await this.core.save(...args)); }
  async analysisComplete(...args: Parameters<ProcessEightDService['analysisComplete']>) { return toHttpEightDReport(await this.core.analysisComplete(...args)); }
  async submit(...args: Parameters<ProcessEightDService['submit']>) { return toHttpEightDReport(await this.core.submit(...args)); }
  async collaborators(...args: Parameters<ProcessEightDService['collaborators']>) { return toHttpEightDReport(await this.core.collaborators(...args)); }
  async reassign(...args: Parameters<ProcessEightDService['reassign']>) { return toHttpEightDReport(await this.core.reassign(...args)); }
  async risk(...args: Parameters<ProcessEightDService['risk']>) { return toHttpEightDReport(await this.core.risk(...args)); }
  async sources(actor: ProcessEightDActor, problemId: string, input: InternalEightDHttpSourcesDto, traceId: string, key: string) { return toHttpEightDReport(await this.core.sources(actor, problemId, toCoreEightDSources(input), traceId, key)); }
  async deadlines(...args: Parameters<ProcessEightDService['deadlines']>) { return toHttpEightDReport(await this.core.deadlines(...args)); }

  complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: ProcessEightDActor) { return this.core.complete(tx, context, actor); }
  returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: ProcessEightDActor) { return this.core.returnForChanges(tx, context, actor); }
}
