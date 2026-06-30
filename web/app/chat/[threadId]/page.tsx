import { ChatShell } from '../../components/chat-shell'

type Props = {
  params: Promise<{ threadId: string }>
}

export default async function ChatThreadPage({ params }: Props) {
  const { threadId } = await params
  return <ChatShell initialThreadId={threadId} />
}
