import { useEffect, useState } from "react";
import { api } from "../api";
import { go } from "../nav";
import { MailThread } from "../components/MailThread";
import { ErrorNotice } from "../components/Notice";
import { Loading } from "../components/Shell";
export function MailPage({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => api.mailItem(id).then(setData).catch(setError);
  useEffect(() => { setData(null); load(); }, [id]);
  return <><button className="btn btn-small back-link" onClick={() => window.history.length > 1 ? window.history.back() : go("/")}>← Back</button>
    <h2>The original email and its thread</h2><ErrorNotice error={error} onDismiss={() => setError(null)} />
    {!data ? !error && <Loading /> : data.threads.map((thread: any) => <MailThread key={thread.id} thread={thread} onChanged={load} />)}
  </>;
}
