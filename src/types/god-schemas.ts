/**
 * God LLM output Zod schemas.
 * Source: AR-002, OQ-002, OQ-003
 * SPEC-DECISION: Schema field names follow Card A.1 spec (refined from FR-001/004/005/008).
 * AI-REVIEW: GodDecisionEnvelope 结构对齐 FR-004 (AC-011~013)，action 与 message 分离确保状态变化仅通过 Hand 执行。
 */

import { z } from 'zod';

// 6 种任务类型
export const TaskTypeSchema = z.enum(['explore', 'code', 'discuss', 'review', 'debug', 'compound']);

// GodTaskAnalysis — FR-001 意图解析输出
export const GodTaskAnalysisSchema = z.object({
  taskType: TaskTypeSchema,
  reasoning: z.string(),
  phases: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: TaskTypeSchema,
    description: z.string(),
  })).nullable().optional(), // compound 类型必须有 phases; non-compound may omit or use null
  confidence: z.number().min(0).max(1),
}).refine(
  (data) => data.taskType !== 'compound' || (data.phases && data.phases.length > 0),
  { message: 'phases must be non-empty when taskType is compound' },
);

export type GodTaskAnalysis = z.infer<typeof GodTaskAnalysisSchema>;
