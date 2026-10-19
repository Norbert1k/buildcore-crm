import QuoteRequests from './QuoteRequests'

// A job's Commercial › Quotes — the same quote-request list as the Quotes
// page, limited to this job.
export default function ProjectQuotesTab({ projectId }) {
  return <QuoteRequests projectId={projectId} />
}
