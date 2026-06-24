import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import ws from "ws";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: ws } }
);
