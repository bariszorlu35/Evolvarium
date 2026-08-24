import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // the simulation engine, copied verbatim from public/sim.js
    'lib/sim.js',
  ]),
  {
    // components/ui/ is vendored from 21st.dev. It is edited only where the
    // Evolvarium palette requires it — rewriting the internals to satisfy the
    // React Compiler lints would make re-pulling upstream versions harder.
    files: ['components/ui/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
])

export default eslintConfig
