import type { DecodeIssue } from '../../types.js'
import { createIssue } from './sectionBuilders.js'

export function buildDeclaredDataSizeIssues(
  messageName: string,
  expectedDataSize: number,
  declaredDataSize: number,
  availableLength: number,
): DecodeIssue[] {
  const issues: DecodeIssue[] = []

  if (declaredDataSize !== expectedDataSize) {
    issues.push(
      createIssue(
        `PD_${messageName.toUpperCase()}_DATA_SIZE_INVALID`,
        `${messageName} declared Data Size ${declaredDataSize}, expected ${expectedDataSize}.`,
      ),
    )
  }

  if (availableLength < expectedDataSize) {
    issues.push(
      createIssue(
        `PD_${messageName.toUpperCase()}_DATA_BLOCK_TRUNCATED`,
        `${messageName} requires ${expectedDataSize} data byte(s), but only ${availableLength} are present in this frame.`,
      ),
    )
  }

  return issues
}
