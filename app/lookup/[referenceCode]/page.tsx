import RejectionSlipPage from '@/app/slip/[referenceCode]/page'

export default function LookupRecordPage({
  params,
}: {
  params: Promise<{ referenceCode: string }> | { referenceCode: string }
}) {
  return <RejectionSlipPage params={params} />
}