// Shared browser/server limits. build.mjs substitutes the SQL placeholders.
export const LIMITS = Object.freeze({ examText: 500, examTextarea: 2000, examNote: 500 });
export const examValueLimit = field => field.type === 'textarea' ? LIMITS.examTextarea : LIMITS.examText;
