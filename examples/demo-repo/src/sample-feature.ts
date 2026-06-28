export interface ProjectNameValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateProjectName(name: string): ProjectNameValidationResult {
  if (name.length === 0) {
    return {
      valid: false,
      reason: "Project name is required."
    };
  }

  if (name.trim().length === 0) {
    return {
      valid: false,
      reason: "Project name cannot be only whitespace."
    };
  }

  if (name.length > 80) {
    return {
      valid: false,
      reason: "Project name must be 80 characters or fewer."
    };
  }

  return {
    valid: true
  };
}
