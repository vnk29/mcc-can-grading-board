const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function testQuery() {
  console.log('Testing open disputes query...');
  const openRes = await supabase
    .from('disputes')
    .select(`
      id, status, submitted_at, resolution_type,
      can_test:can_tests!inner (
        reference_code, decision, test_performed_at,
        farmer:farmers!inner (name)
      )
    `)
    .eq('status', 'open')
    .order('submitted_at', { ascending: false });

  console.log('Open Result:');
  console.log(JSON.stringify(openRes, null, 2));
}

testQuery();
