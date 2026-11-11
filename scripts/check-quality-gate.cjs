'use strict';

// Deze vaste eindcontrole mag ook bij overgeslagen of afgebroken taken niet slagen.
const REQUIRED_JOBS = ['validate', 'browser', 'site'];

function checkQualityGate(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('De resultaten van de vereiste controles ontbreken.');
  }
  const failures = REQUIRED_JOBS.filter(job => needs[job]?.result !== 'success');
  if (failures.length) {
    throw new Error(failures.map(job => `${job}: ${needs[job]?.result || 'ontbreekt'}`).join(', '));
  }
}

if (require.main === module) {
  try {
    checkQualityGate(JSON.parse(process.env.NEEDS_JSON || 'null'));
    console.log('GESLAAGD: alle vereiste controles en het websitepakket zijn geslaagd.');
  } catch (error) {
    console.error('PUBLICATIE GEBLOKKEERD:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkQualityGate };
