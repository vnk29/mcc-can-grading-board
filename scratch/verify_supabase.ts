import { createClient } from '@supabase/supabase-js'

const url = 'https://mneillacklgzhhjqqzff.supabase.co'
const key = 'sb_publishable_nxmfpnAupifv9OmsO4d_KQ_ZXPf4YsP'
const supabase = createClient(url, key)

async function run() {
  console.log("Testing Operators...")
  const opRes = await supabase.from('operators').select('id, pin').limit(1)
  console.log("Operators:", opRes.error ? opRes.error.message : (opRes.data?.length > 0 ? "PASS" : "FAIL (Empty)"))

  console.log("Testing Farmers...")
  const fmRes = await supabase.from('farmers').select('id').limit(1)
  console.log("Farmers:", fmRes.error ? fmRes.error.message : (fmRes.data?.length > 0 ? "PASS" : "FAIL (Empty)"))

  console.log("Testing can_tests read...")
  const ctRes = await supabase.from('can_tests').select('id').limit(1)
  console.log("can_tests read:", ctRes.error ? ctRes.error.message : "PASS")
  
  if (opRes.data && opRes.data.length > 0 && fmRes.data && fmRes.data.length > 0) {
    const opId = opRes.data[0].id
    const opPin = opRes.data[0].pin
    const fmId = fmRes.data[0].id
    console.log(`\nUsing opId: ${opId}, fmId: ${fmId}`)
    
    let createdIds: string[] = []
    
    try {
      // Test Accepted Insert
      const refCode = `TEST-ACCEPTED-${Date.now()}`
      const insRes = await supabase.from('can_tests').insert({
        farmer_id: fmId,
        operator_id: opId,
        can_volume: 10,
        fat_percent: 6.5,
        snf_percent: 8.5,
        temperature: 5.0,
        adulteration_result: false,
        auto_decision: 'accepted',
        decision: 'accepted',
        is_borderline: false,
        reason_codes: [],
        borderline_flags: [],
        is_override: false,
        reference_code: refCode,
        test_performed_at: new Date().toISOString()
      }).select().single()
      
      console.log("Accepted Insert:", insRes.error ? insRes.error.message : `PASS (Ref: ${insRes.data.reference_code})`)
      if (insRes.data?.id) createdIds.push(insRes.data.id)

      // Test Rejected Insert
      const refCodeRej = `TEST-REJECTED-${Date.now()}`
      const insRejRes = await supabase.from('can_tests').insert({
        farmer_id: fmId,
        operator_id: opId,
        can_volume: 10,
        fat_percent: 1.0,
        snf_percent: 8.5,
        temperature: 5.0,
        adulteration_result: false,
        auto_decision: 'rejected',
        decision: 'rejected',
        is_borderline: false,
        reason_codes: ['LOW_FAT'],
        borderline_flags: [],
        is_override: false,
        reference_code: refCodeRej,
        test_performed_at: new Date().toISOString()
      }).select().single()
      console.log("Rejected Insert:", insRejRes.error ? insRejRes.error.message : `PASS (Ref: ${insRejRes.data?.reference_code})`)
      if (insRejRes.data?.id) createdIds.push(insRejRes.data.id)
      
      if (!insRes.error) {
         // Test Correction (Authorization / Immutability)
         console.log("Testing Correction Authorization (Wrong PIN)...")
         const corrRes = await supabase.rpc('submit_correction', {
           p_operator_id: opId,
           p_pin: '0000', // Invalid PIN
           p_can_test_id: insRes.data.id,
           p_new_values: { fat_percent: 7.0 },
           p_reason: 'Testing'
         })
         console.log("Correction with bad PIN:", corrRes.error ? `PASS (Blocked: ${corrRes.error.message})` : "FAIL (Allowed!)")

         console.log("Testing Correction Authorization (Correct PIN)...")
         const corrResValid = await supabase.rpc('submit_correction', {
           p_operator_id: opId,
           p_pin: opPin,
           p_can_test_id: insRes.data.id,
           p_new_values: { fat_percent: 7.0 },
           p_reason: 'Testing Valid'
         })
         console.log("Correction with correct PIN:", corrResValid.error ? `FAIL (${corrResValid.error.message})` : "PASS")

         // Verify can_tests immutability
         const verifyRes = await supabase.from('can_tests').select('fat_percent').eq('id', insRes.data.id).single()
         console.log("Immutability Check (Original fat % unchanged):", verifyRes.data?.fat_percent === 6.5 ? "PASS" : "FAIL")
      }
    } finally {
      if (createdIds.length > 0) {
        console.log("Cleaning up test records...")
        await supabase.from('corrections').delete().in('can_test_id', createdIds)
        await supabase.from('can_tests').delete().in('id', createdIds)
      }
    }
  }
}
run()
