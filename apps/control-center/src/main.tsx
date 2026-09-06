import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceReportingForms } from './FinanceReportingForms';
import { PilotActivationPanel } from './PilotActivationPanel';
import './styles.css';

// Existing Control Center implementation retained. Lead approval evidence is now rendered
// by the main React approval card rather than a DOM enhancement layer, preventing duplicates.
