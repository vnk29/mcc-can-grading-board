const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testQuery() {
  console.log('Testing open disputes query with admin key...');
  const openRes = await supabaseAdmin
    .from('disputes')
    .select('id')
    .limit(1);

  console.log('Result:', JSON.stringify(openRes, null, 2));
}

testQuery();
