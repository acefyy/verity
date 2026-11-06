/**
 * Builds the exact 2-field Discord Components V2 modal payload.
 * Wraps inputs inside ComponentType.LABEL (18).
 * Honors the requireEvidence server configuration setting.
 */
export function buildReportModal(
  sessionId: string,
  targetMessageId: string,
  requireEvidence: boolean = false
) {
  return {
    title: 'Report Message',
    custom_id: `verity:modal:report:${sessionId}`,
    components: [
      {
        type: 18, // ComponentType.LABEL
        label: 'Reason for Report',
        description: 'Explain specifically why this message violates server rules',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:reason',
          style: 2, // Paragraph
          min_length: 15,
          max_length: 1000,
          placeholder: 'Describe what occurred, context, and the community rule violated...',
          required: true
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: requireEvidence ? 'Evidence & Screenshots (Required)' : 'Evidence & Screenshots (Optional)',
        description: requireEvidence
          ? 'Attach 1 to 5 image or document files (Required by server policy)'
          : 'Attach up to 5 image or document files (Max 10MB each)',
        component: {
          type: 19, // ComponentType.FILE_UPLOAD
          custom_id: 'verity:field:proof_upload',
          min_values: requireEvidence ? 1 : 0,
          max_values: 5,
          required: requireEvidence,
          file_types: ['image', '.png', '.jpg', '.jpeg', '.webp', '.pdf']
        }
      }
    ]
  };
}
