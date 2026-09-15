import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (request) => {
  if (request.headers.get("authorization") !== `Bearer ${Deno.env.get("CRON_SECRET")}`) return new Response("Unauthorized", { status: 401 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const now = new Date().toISOString();
  const { data: due, error } = await admin.from("notes").update({ push_claimed_at: now }).is("push_claimed_at", null).eq("status", "sealed").lte("deliver_at", now).select("id,recipient_id").limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  for (const note of due ?? []) {
    const { data: subscriptions } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", note.recipient_id);
    await Promise.allSettled((subscriptions ?? []).map((sub) => webpush.sendNotification({ endpoint:sub.endpoint, keys:{ p256dh:sub.p256dh, auth:sub.auth } }, JSON.stringify({ title:"纸条", body:"你有一条新消息。", url:"/" }))));
    await admin.from("notes").update({ status:"delivered", delivered_at:now }).eq("id",note.id).eq("push_claimed_at",now);
  }
  return Response.json({ delivered: due?.length ?? 0 });
});
