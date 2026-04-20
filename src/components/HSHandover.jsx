import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import UploadProgress from './UploadProgress'

// ── Full H&S folder template ─────────────────────────────────
const HS_STRUCTURE = [
  { key: 's1', label: 'Section 1 | H&S File', color: '#448a40', bg: '#e8f5e7', children: [] },
  { key: 's2', label: 'Section 2 | Project Directory', color: '#448a40', bg: '#e8f5e7', children: [] },
  { key: 's3', label: 'Section 3 | Record Drawings', color: '#378ADD', bg: '#E6F1FB', children: [
    { key: 's3-1', label: '3.1 As Built Drawings', children: [
      { key: 's3-1-01', label: '01. Superseded', children: [] },
      { key: 's3-1-02', label: '02. Unclassified', children: [] },
      { key: 's3-1-03', label: '03. Floor Plans', children: [] },
      { key: 's3-1-04', label: '04. Drawings', children: [
        { key: 's3-1-04-01', label: '01. Superseded', children: [] },
        { key: 's3-1-04-02', label: '02. Unclassified', children: [] },
        { key: 's3-1-04-03', label: '03. Fire Strategy', children: [] },
        { key: 's3-1-04-04', label: '04. Ceiling Layout', children: [] },
        { key: 's3-1-04-05', label: '05. Floor Setting Out Plan', children: [] },
        { key: 's3-1-04-06', label: '06. Floor Finishes', children: [] },
        { key: 's3-1-04-07', label: '07. Internal Wall Type', children: [] },
        { key: 's3-1-04-08', label: '08. External Wall Type', children: [] },
        { key: 's3-1-04-09', label: '09. Window and Door Code', children: [] },
        { key: 's3-1-04-10', label: '10. External Wall Setting Out', children: [] },
        { key: 's3-1-04-11', label: '11. Cavity Barrier Locations', children: [] },
        { key: 's3-1-04-12', label: '12. Proposed Stair Core', children: [] },
        { key: 's3-1-04-13', label: '13. Service Hole Setting Out', children: [] },
        { key: 's3-1-04-14', label: '14. Slab Setting Out', children: [] },
        { key: 's3-1-04-15', label: '15. Floor Plans', children: [] },
        { key: 's3-1-04-16', label: '16. Elevations', children: [] },
        { key: 's3-1-04-17', label: '17. Block Slab Edge', children: [] },
        { key: 's3-1-04-18', label: '18. Angled Brick Bay', children: [] },
        { key: 's3-1-04-19', label: '19. Lift Plan', children: [] },
        { key: 's3-1-04-20', label: '20. Sections AA BB CC', children: [] },
        { key: 's3-1-04-21', label: '21. Window Head Cill & Jamb', children: [] },
        { key: 's3-1-04-22', label: '22. Roof Detail & Type', children: [] },
        { key: 's3-1-04-23', label: '23. Special Shaped Bricks', children: [] },
        { key: 's3-1-04-24', label: '24. Bolt on Balcony', children: [] },
        { key: 's3-1-04-25', label: '25. Terrace', children: [] },
        { key: 's3-1-04-26', label: '26. Lift Overrun Junction', children: [] },
      ]},
      { key: 's3-1-05', label: '05. General Drawings', children: [
        { key: 's3-1-05-01', label: '01. Floor Area Measure', children: [] },
        { key: 's3-1-05-02', label: '02. Superseded', children: [] },
        { key: 's3-1-05-03', label: '03. Unclassified', children: [] },
        { key: 's3-1-05-04', label: '04. External Wall Detail', children: [] },
        { key: 's3-1-05-05', label: '05. External Doors', children: [] },
        { key: 's3-1-05-06', label: '06. Internal Doors', children: [] },
        { key: 's3-1-05-07', label: '07. Windows', children: [] },
        { key: 's3-1-05-08', label: '08. Substation', children: [] },
        { key: 's3-1-05-09', label: '09. Bathroom & Showers (Elevations)', children: [] },
        { key: 's3-1-05-10', label: '10. Internal Wall Types', children: [] },
        { key: 's3-1-05-11', label: '11. Separating Floor Types', children: [] },
        { key: 's3-1-05-12', label: '12. AOV Hatch', children: [] },
        { key: 's3-1-05-13', label: '13. Site Setting Out Plan', children: [] },
        { key: 's3-1-05-14', label: '14. Site Setting Out Externals', children: [] },
        { key: 's3-1-05-15', label: '15. Soffit Detail - Brick Wall', children: [] },
        { key: 's3-1-05-16', label: '16. Stone Detail External', children: [] },
        { key: 's3-1-05-17', label: '17. Brickwork Detail External', children: [] },
      ]},
    ]},
    { key: 's3-2', label: '3.2 Soft & Hard Landscaping', children: [] },
    { key: 's3-3', label: '3.3 Smoke Detector', children: [] },
    { key: 's3-4', label: '3.4 Sprinkler', children: [] },
  ]},
  { key: 's4', label: 'Section 4 | Construction Materials', color: '#BA7517', bg: '#FAEEDA', children: [
    { key: 's4-1', label: '4.1 Schedule of Equipment', children: [
      { key: 's4-1-01', label: '01. Walls - Plasterboard', children: [
        { key: 's4-1-01-01', label: '01. Siniat', children: [
          { key: 's4-1-01-01-01', label: '01. Blue - Sound', children: [] },
          { key: 's4-1-01-01-02', label: '02. Pink - Fire', children: [] },
          { key: 's4-1-01-01-03', label: '03. Green - Moisture', children: [] },
          { key: 's4-1-01-01-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's4-1-01-02', label: '02. Knauf', children: [
          { key: 's4-1-01-02-01', label: '01. Blue - Sound', children: [] },
          { key: 's4-1-01-02-02', label: '02. Pink - Fire', children: [] },
          { key: 's4-1-01-02-03', label: '03. Green - Moisture', children: [] },
          { key: 's4-1-01-02-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's4-1-01-03', label: '03. British Gypsum', children: [] },
        { key: 's4-1-01-00', label: '00. Unclassified', children: [] },
      ]},
      { key: 's4-1-02', label: '02. Doors', children: [
        { key: 's4-1-02-01', label: '01. Door Closer', children: [] },
        { key: 's4-1-02-02', label: '02. Door Stops - Ironmongery', children: [] },
        { key: 's4-1-02-03', label: '03. Doors', children: [] },
        { key: 's4-1-02-04', label: '04. Door Handles', children: [] },
      ]},
      { key: 's4-1-03', label: '03. Smoke Shaft', children: [] },
      { key: 's4-1-04', label: '04. Roof - Euro Clad', children: [] },
      { key: 's4-1-05', label: '05. Radiators', children: [
        { key: 's4-1-05-01', label: '01. Mylek Rads', children: [] },
        { key: 's4-1-05-02', label: '02. Bathrooms', children: [] },
      ]},
      { key: 's4-1-06', label: '06. Plumbing', children: [
        { key: 's4-1-06-01', label: '01. SVPs & RWPs', children: [] },
        { key: 's4-1-06-02', label: '02. Booster Set with Enhanced Controls', children: [] },
        { key: 's4-1-06-03', label: '03. Gas Safe Certificates', children: [] },
      ]},
      { key: 's4-1-07', label: '07. Electrical', children: [
        { key: 's4-1-07-01', label: '01. CCTV', children: [] },
        { key: 's4-1-07-02', label: '02. Electric', children: [] },
        { key: 's4-1-07-03', label: '03. Intercom', children: [] },
      ]},
      { key: 's4-1-08', label: '08. Mastics', children: [] },
      { key: 's4-1-09', label: '09. Insulation', children: [] },
      { key: 's4-1-10', label: '10. Lintels', children: [] },
      { key: 's4-1-11', label: '11. Bathrooms', children: [] },
      { key: 's4-1-12', label: '12. PV Panels', children: [] },
      { key: 's4-1-13', label: '13. Pipe Lagging', children: [] },
      { key: 's4-1-14', label: '14. MVHR', children: [] },
      { key: 's4-1-15', label: '15. Cylinders', children: [] },
      { key: 's4-1-16', label: '16. Flooring', children: [] },
      { key: 's4-1-17', label: '17. Fire Foam', children: [] },
      { key: 's4-1-18', label: '18. Lifts', children: [
        { key: 's4-1-18-01', label: '01. Maintenance Agreement', children: [] },
        { key: 's4-1-18-02', label: '02. Lift', children: [
          { key: 's4-1-18-02-01', label: '01. Owner Manual', children: [] },
          { key: 's4-1-18-02-02', label: '02. Declarations & Test Certs', children: [] },
          { key: 's4-1-18-02-03', label: '03. Drawings', children: [] },
          { key: 's4-1-18-02-04', label: '04. Service Contact Details', children: [] },
        ]},
      ]},
      { key: 's4-1-19', label: '19. Lighting', children: [] },
      { key: 's4-1-20', label: '20. Landscaping', children: [] },
      { key: 's4-1-21', label: '21. Lightning Conductor', children: [] },
      { key: 's4-1-22', label: '22. Plantroom Tanks', children: [] },
      { key: 's4-1-23', label: '23. Windows', children: [
        { key: 's4-1-23-01', label: '01. Acoustics Specs', children: [] },
        { key: 's4-1-23-02', label: '02. Design Specs', children: [] },
        { key: 's4-1-23-03', label: '03. Cills', children: [] },
      ]},
      { key: 's4-1-24', label: '24. Brickwork', children: [
        { key: 's4-1-24-01', label: '01. Bricks', children: [] },
        { key: 's4-1-24-02', label: '02. Mortar', children: [] },
      ]},
      { key: 's4-1-25', label: '25. Kitchens', children: [] },
      { key: 's4-1-26', label: '26. Wardrobes', children: [] },
      { key: 's4-1-27', label: '27. Access Panels', children: [] },
      { key: 's4-1-28', label: '28. Bike & Bin Store (External)', children: [] },
      { key: 's4-1-29', label: '29. Balcony', children: [
        { key: 's4-1-29-01', label: '01. As-Built GAs', children: [] },
        { key: 's4-1-29-02', label: '02. COSHH', children: [] },
        { key: 's4-1-29-03', label: '03. Structural Calculations', children: [] },
      ]},
      { key: 's4-1-30', label: '30. Fire System', children: [] },
      { key: 's4-1-31', label: '31. Sprinklers', children: [] },
      { key: 's4-1-32', label: '32. Residents Information', children: [] },
      { key: 's4-1-33', label: '33. Fire Sealant & Paint', children: [] },
      { key: 's4-1-34', label: '34. HVAC', children: [] },
    ]},
  ]},
  { key: 's5', label: 'Section 5 | Health and Safety', color: '#E24B4A', bg: '#FCEBEB', children: [
    { key: 's5-1', label: '5.1 Site Investigations, Environmental Reports & Soil Remediation', children: [] },
    { key: 's5-2', label: '5.2 Site Waste Management Plan (Record Information)', children: [] },
  ]},
  { key: 's6', label: 'Section 6 | Structural Design', color: '#888780', bg: '#F1EFE8', children: [
    { key: 's6-1', label: '6.1 Structural Designs - Principle', children: [] },
    { key: 's6-2', label: '6.2 Structural Engineer', children: [] },
  ]},
  { key: 's7', label: 'Section 7 | Services', color: '#378ADD', bg: '#E6F1FB', children: [
    { key: 's7-1', label: '7.1 Services Overview', children: [
      { key: 's7-1-01', label: '01. As Built Drawings', children: [
        { key: 's7-1-01-01', label: '01. Floor Plans', children: [] },
        { key: 's7-1-01-02', label: '02. Roof', children: [] },
      ]},
      { key: 's7-1-02', label: '02. As Built - Fire', children: [
        { key: 's7-1-02-01', label: '01. Unclassified', children: [] },
        { key: 's7-1-02-02', label: '02. As Fitted Drawings - As Wired Devices', children: [] },
        { key: 's7-1-02-03', label: '03. Fire Strategy', children: [] },
        { key: 's7-1-02-04', label: '04. Fire System Data', children: [
          { key: 's7-1-02-04-01', label: '01. Data Sheets', children: [] },
        ]},
      ]},
      { key: 's7-1-03', label: '03. Utilities', children: [
        { key: 's7-1-03-01', label: '01. Electrical', children: [] },
        { key: 's7-1-03-02', label: '02. Fibre', children: [] },
      ]},
    ]},
  ]},
  { key: 's8', label: 'Section 8 | O&M Manuals', color: '#534AB7', bg: '#EEEDFE', children: [
    { key: 's8-1', label: '8.1 Residents Information Pack', children: [] },
    { key: 's8-2', label: '8.2 Colour and Style Repair Replacement Information for Facade & Roof', children: [] },
    { key: 's8-3', label: '8.3 Cleaning and Maintenance', children: [] },
    { key: 's8-4', label: '8.4 Catalogue - All', children: [
      { key: 's8-4-01', label: '01. Walls - Plasterboard', children: [
        { key: 's8-4-01-01', label: '01. Siniat', children: [
          { key: 's8-4-01-01-01', label: '01. Blue - Sound', children: [] },
          { key: 's8-4-01-01-02', label: '02. Pink - Fire', children: [] },
          { key: 's8-4-01-01-03', label: '03. Green - Moisture', children: [] },
          { key: 's8-4-01-01-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's8-4-01-02', label: '02. Knauf', children: [
          { key: 's8-4-01-02-01', label: '01. Blue - Sound', children: [] },
          { key: 's8-4-01-02-02', label: '02. Pink - Fire', children: [] },
          { key: 's8-4-01-02-03', label: '03. Green - Moisture', children: [] },
          { key: 's8-4-01-02-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's8-4-01-03', label: '03. British Gypsum', children: [] },
        { key: 's8-4-01-00', label: '00. Unclassified', children: [] },
      ]},
      { key: 's8-4-02', label: '02. Doors', children: [
        { key: 's8-4-02-01', label: '01. Door Closer', children: [] },
        { key: 's8-4-02-02', label: '02. Door Stops - Ironmongery', children: [] },
        { key: 's8-4-02-03', label: '03. Doors', children: [] },
        { key: 's8-4-02-04', label: '04. Door Handles', children: [] },
      ]},
      { key: 's8-4-03', label: '03. Smoke Shaft', children: [] },
      { key: 's8-4-04', label: '04. Roof', children: [] },
      { key: 's8-4-05', label: '05. Radiators', children: [] },
      { key: 's8-4-06', label: '06. Plumbing', children: [
        { key: 's8-4-06-01', label: '01. SVPs & RWPs', children: [] },
        { key: 's8-4-06-02', label: '02. Booster Set with Enhanced Controls', children: [] },
        { key: 's8-4-06-03', label: '03. Gas Safe Certificates', children: [] },
      ]},
      { key: 's8-4-07', label: '07. Electrical', children: [
        { key: 's8-4-07-01', label: '01. CCTV', children: [] },
        { key: 's8-4-07-02', label: '02. Electric', children: [] },
        { key: 's8-4-07-03', label: '03. Intercom', children: [] },
      ]},
      { key: 's8-4-08', label: '08. Mastics', children: [] },
      { key: 's8-4-09', label: '09. Insulation', children: [] },
      { key: 's8-4-10', label: '10. Lintels', children: [] },
      { key: 's8-4-11', label: '11. Bathrooms', children: [] },
      { key: 's8-4-12', label: '12. PV Panels', children: [] },
      { key: 's8-4-13', label: '13. Power On', children: [
        { key: 's8-4-13-01', label: '01. Electrical Design Pack', children: [] },
        { key: 's8-4-13-02', label: '02. Fibre', children: [] },
        { key: 's8-4-13-03', label: '03. Electrical Design Pack', children: [] },
      ]},
      { key: 's8-4-14', label: '14. Pipe Lagging', children: [] },
      { key: 's8-4-15', label: '15. MVHR', children: [] },
      { key: 's8-4-16', label: '16. Cylinders', children: [] },
      { key: 's8-4-17', label: '17. Flooring', children: [
        { key: 's8-4-17-01', label: '01. Tiles', children: [] },
        { key: 's8-4-17-02', label: '02. Carpet Tile', children: [] },
      ]},
      { key: 's8-4-18', label: '18. Fire Foam', children: [] },
      { key: 's8-4-19', label: '19. Lifts', children: [
        { key: 's8-4-19-01', label: '01. Maintenance Agreement', children: [] },
        { key: 's8-4-19-02', label: '02. Lift', children: [
          { key: 's8-4-19-02-01', label: '01. Owner Manual', children: [] },
          { key: 's8-4-19-02-02', label: '02. Declarations & Test Certs', children: [] },
          { key: 's8-4-19-02-03', label: '03. Drawings', children: [] },
          { key: 's8-4-19-02-04', label: '04. Service Contact Details', children: [] },
        ]},
      ]},
      { key: 's8-4-20', label: '20. Lighting', children: [] },
      { key: 's8-4-21', label: '21. Landscaping', children: [] },
      { key: 's8-4-22', label: '22. Lightning Conductor', children: [] },
      { key: 's8-4-23', label: '23. Plantroom Tanks', children: [] },
      { key: 's8-4-24', label: '24. Windows', children: [
        { key: 's8-4-24-01', label: '01. Acoustics Specs', children: [] },
        { key: 's8-4-24-02', label: '02. Design Spec', children: [] },
        { key: 's8-4-24-03', label: '03. Cills', children: [] },
      ]},
      { key: 's8-4-25', label: '25. Brickwork', children: [
        { key: 's8-4-25-01', label: '01. Bricks', children: [] },
        { key: 's8-4-25-02', label: '02. Mortar', children: [] },
      ]},
      { key: 's8-4-26', label: '26. Kitchens', children: [] },
      { key: 's8-4-27', label: '27. Wardrobes', children: [] },
      { key: 's8-4-28', label: '28. Access Panels', children: [] },
      { key: 's8-4-29', label: '29. Bike & Bin Store (External)', children: [] },
      { key: 's8-4-30', label: '30. Balcony', children: [
        { key: 's8-4-30-01', label: '01. As-Built GAs', children: [] },
        { key: 's8-4-30-02', label: '02. COSHH', children: [] },
        { key: 's8-4-30-03', label: '03. Structural Calculations', children: [] },
      ]},
      { key: 's8-4-31', label: '31. Fire System', children: [
        { key: 's8-4-31-01', label: '01. Data Sheets', children: [] },
      ]},
      { key: 's8-4-32', label: '32. Sprinklers', children: [] },
      { key: 's8-4-33', label: '33. Residents Information', children: [] },
      { key: 's8-4-34', label: '34. Fire Sealant & Paint', children: [] },
      { key: 's8-4-35', label: '35. HVAC', children: [] },
      { key: 's8-4-36', label: '36. Paint', children: [] },
      { key: 's8-4-37', label: '37. OFNL', children: [] },
    ]},
  ]},
  { key: 's9', label: 'Section 9 | Commissioning Documents', color: '#0F6E56', bg: '#E1F5EE', children: [
    { key: 's9-1', label: '9.1 Commissioning Records (Part 1)', children: [] },
    { key: 's9-2', label: '9.2 Commissioning Records (Part 2)', children: [] },
  ]},
  { key: 's10', label: 'Section 10 | Operating Documents', color: '#0F6E56', bg: '#E1F5EE', children: [
    { key: 's10-1', label: '10.1 Operating Records', children: [] },
  ]},
  { key: 's11', label: 'Section 11 | Certificates', color: '#993C1D', bg: '#FAECE7', children: [
    { key: 's11-1', label: '11.1 Building Control & Building Insurance', children: [
      { key: 's11-1-01', label: '01. Flats Certs', children: [] },
      { key: 's11-1-02', label: '02. Building Insurance', children: [] },
    ]},
    { key: 's11-2', label: '11.2 Emergency Lighting Safety Certificate', children: [
      { key: 's11-2-01', label: '01. Communal Lighting', children: [] },
      { key: 's11-2-02', label: '02. Emergency Lighting', children: [] },
    ]},
    { key: 's11-3', label: '11.3 Electrical Safety Certificate', children: [
      { key: 's11-3-01', label: '01. EICR', children: [] },
    ]},
    { key: 's11-4', label: '11.4 Fire Alarm Certificate', children: [
      { key: 's11-4-01', label: '01. Commissioning Certificates', children: [] },
    ]},
    { key: 's11-5', label: '11.5 AOV & Smoke Shaft', children: [] },
    { key: 's11-6', label: '11.6 Dry Riser Commissioning', children: [] },
    { key: 's11-7', label: '11.7 Lift Commissioning', children: [
      { key: 's11-7-01', label: '01. Declarations & Test Certs', children: [] },
      { key: 's11-7-02', label: '02. Lift', children: [
        { key: 's11-7-02-01', label: '01. Owner Manual', children: [] },
        { key: 's11-7-02-02', label: '02. Drawings', children: [] },
        { key: 's11-7-02-03', label: '03. Service Contact Details', children: [] },
      ]},
    ]},
    { key: 's11-8', label: '11.8 Energy Performance Certificates & SAP', children: [
      { key: 's11-8-01', label: '01. EPCs', children: [] },
      { key: 's11-8-02', label: '02. SAPs', children: [] },
    ]},
    { key: 's11-9', label: '11.9 Air & Sound Test Certificates', children: [
      { key: 's11-9-01', label: '01. MVHR Air Test', children: [] },
      { key: 's11-9-02', label: '02. Air Permeability Test', children: [] },
      { key: 's11-9-03', label: '03. Sound Test', children: [] },
    ]},
    { key: 's11-10', label: '11.10 Fire Stopping Certificate', children: [] },
    { key: 's11-11', label: '11.11 Water Efficiency Certs (Block)', children: [] },
    { key: 's11-12', label: '11.12 Planning Approval & Condition Sign Off', children: [] },
  ]},
]

// ── Helpers ───────────────────────────────────────────────────
function getAllKeys(nodes, acc = []) {
  nodes.forEach(n => { acc.push(n.key); if (n.children?.length) getAllKeys(n.children, acc) })
  return acc
}

function getAllLeafKeys(nodes, acc = []) {
  nodes.forEach(n => {
    if (!n.children?.length) acc.push(n.key)
    else getAllLeafKeys(n.children, acc)
  })
  return acc
}

function findSection(nodes, key) {
  for (const n of nodes) {
    if (n.key === key) return n
    if (n.children?.length) {
      const found = findSection(n.children, key)
      if (found) return found
    }
  }
  return null
}

function buildPaths(nodes, parentPath, map) {
  for (const node of nodes) {
    const safeName = node.label.replace(/\|/g, '-')
    const path = parentPath ? parentPath + '/' + safeName : safeName
    map[node.key] = path
    if (node.children && node.children.length > 0) {
      buildPaths(node.children, path, map)
    }
  }
  return map
}


// ── Upgrade utilities ─────────────────────────────────────────────────────────
async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl); const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch { const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click() }
}

async function readDropEntries(e) {
  const items = e.dataTransfer?.items
  if (!items) return { files: Array.from(e.dataTransfer?.files || []), folders: [] }
  const entries = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  if (!entries.length) return { files: Array.from(e.dataTransfer?.files || []), folders: [] }
  const result = { files: [], folders: new Set() }
  async function walk(entry, path) {
    if (entry.isFile) {
      const file = await new Promise(r => entry.file(r))
      result.files.push({ file, path })
      if (path) result.folders.add(path)
    } else if (entry.isDirectory) {
      const dirPath = path ? path + '/' + entry.name : entry.name
      result.folders.add(dirPath)
      const reader = entry.createReader()
      const children = await new Promise(r => reader.readEntries(r))
      for (const child of children) await walk(child, dirPath)
    }
  }
  for (const entry of entries) await walk(entry, '')
  return { files: result.files, folders: [...result.folders] }
}
function naturalSort(arr) {
  return [...arr].sort((a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' }))
}
const Btn  = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)',     borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnG = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40',           borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40',        display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnR = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)',    display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }

function ExcelPreview({ url, fileName, onClose, onDownload }) {
  const [html, setHtml] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sheets, setSheets] = useState([])
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    async function load() {
      try {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        document.head.appendChild(script)
        await new Promise((r, j) => { script.onload = r; script.onerror = j })
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        const wb = window.XLSX.read(buf, { type: 'array' })
        if (cancelled) return
        const allSheets = wb.SheetNames.map(name => ({
          name,
          html: window.XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false })
        }))
        setSheets(allSheets)
        setHtml(allSheets[0]?.html || '<p>Empty spreadsheet</p>')
        setLoading(false)
      } catch (e) { if (!cancelled) { setError(e.message); setLoading(false) } }
    }
    load()
    return () => { cancelled = true }
  }, [url])

  function switchSheet(i) {
    setActiveSheet(i)
    setHtml(sheets[i]?.html || '')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 1 }}>
        {onDownload && <button onClick={e => { e.stopPropagation(); onDownload() }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
        <button onClick={onClose} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 8, marginTop: 8 }}>{fileName}</div>
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }} onClick={e => e.stopPropagation()}>
          {sheets.map((s, i) => (
            <button key={i} onClick={() => switchSheet(i)}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '0.5px solid rgba(255,255,255,0.3)', background: i === activeSheet ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', cursor: 'pointer' }}>{s.name}</button>
          ))}
        </div>
      )}
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, width: '95vw', maxHeight: '85vh', overflow: 'auto', background: '#fff', borderRadius: 8, padding: 0 }}>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading spreadsheet...</div>
          : error ? <div style={{ padding: 40, textAlign: 'center', color: '#e24b4a' }}>Failed to load: {error}</div>
          : <div style={{ fontSize: 12, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: `<style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d0d0;padding:6px 10px;font-size:13px;color:#1a1a1a;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis}th{background:#e8e8e8;font-weight:600;color:#111;position:sticky;top:0}tr:nth-child(even){background:#f5f5f5}tr:hover{background:#e6f1fb}</style>${html}` }} />
        }
      </div>
    </div>
  )
}
function ViewToggle({ viewMode, setView }) {
  const views = [
    { mode: 'grid', title: 'Grid', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
    { mode: 'compact', title: 'Compact', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4"/><rect x="18" y="2" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="18" y="10" width="4" height="4"/><rect x="2" y="18" width="4" height="4"/><rect x="10" y="18" width="4" height="4"/><rect x="18" y="18" width="4" height="4"/></svg> },
    { mode: 'list', title: 'List', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
      {views.map(({ mode, title, icon }) => (
        <button key={mode} onClick={() => setView(mode)} title={title}
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0, flexShrink: 0 }}>
          {icon}
        </button>
      ))}
    </div>
  )
}
function BulkBar({ selected, onZip, onMove, onClear, moveTargets }) {
  const [showMove, setShowMove] = useState(false)
  const [movePos, setMovePos] = useState({ bottom: 80, left: 400 })
  if (!selected.size) return null
  function openMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    setMovePos({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
    setShowMove(v => !v)
  }
  return (
    <>
      <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: 'var(--accent)', color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
        <button onClick={onZip} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>↓ Download ZIP</button>
        {onMove && <button onClick={openMove} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: showMove ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', cursor: 'pointer' }}>Move to ▾</button>}
        <button onClick={onClear} style={{ fontSize: 12, lineHeight: '26px', padding: '0 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>✕ Clear</button>
      </div>
      {showMove && moveTargets && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 600 }} onClick={() => setShowMove(false)} />
          <div style={{ position: 'fixed', bottom: movePos.bottom, left: movePos.left, zIndex: 601, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, minWidth: 240, maxHeight: 320, overflowY: 'auto', boxShadow: '0 -4px 24px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '0.5px solid var(--border)' }}>Move to folder</div>
            {moveTargets.map(t => (
              <div key={t.key} onClick={() => { onMove(t.key); setShowMove(false) }}
                style={{ padding: '8px 14px 8px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                📁 {t.label}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}

const HS_ICONS = {
  s1: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  s2: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  s3: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"/>
    </svg>
  ),
  s4: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  s5: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5"/>
    </svg>
  ),
  s6: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 19 22 19"/>
      <line x1="12" y1="8" x2="12" y2="19"/>
      <line x1="7" y1="19" x2="17" y2="19"/>
      <line x1="5" y1="15" x2="9" y2="15"/>
      <line x1="15" y1="15" x2="19" y2="15"/>
    </svg>
  ),
  s7: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="6" height="6" rx="1"/>
      <rect x="16" y="3" width="6" height="6" rx="1"/>
      <rect x="2" y="15" width="6" height="6" rx="1"/>
      <rect x="16" y="15" width="6" height="6" rx="1"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="18" x2="16" y2="18"/>
      <line x1="5" y1="9" x2="5" y2="15"/>
      <line x1="19" y1="9" x2="19" y2="15"/>
      <line x1="12" y1="6" x2="12" y2="18"/>
    </svg>
  ),
  s8: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      <line x1="9" y1="8" x2="6" y2="8"/>
      <line x1="9" y1="11" x2="6" y2="11"/>
      <line x1="15" y1="8" x2="18" y2="8"/>
      <line x1="15" y1="11" x2="18" y2="11"/>
    </svg>
  ),
  s9: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  s10: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M9 15l2 2 4-4"/>
    </svg>
  ),
  s11: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/>
      <path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/>
      <line x1="12" y1="5" x2="12" y2="8"/>
      <line x1="12" y1="8" x2="14" y2="10"/>
    </svg>
  ),
}

function getColor(node, depth) {
  if (node.color) return node.color
  return '#888780'
}

// ── File Card ─────────────────────────────────────────────────
function HSFileCard({ file, onDelete, canDelete, selected, onSelect, onPreview }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const isPdf = file.file_name?.toLowerCase().endsWith('.pdf')
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.file_name || '')
  const isWord = /\.docx?$/i.test(file.file_name || '')
  const isExcel = /\.xlsx?$/i.test(file.file_name || '')
  const isPpt = /\.pptx?$/i.test(file.file_name || '')
  const ext = file.file_name?.split('.').pop()?.toUpperCase().slice(0, 4) || '?'

  useEffect(() => {
    supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('hs_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  async function download() {
    const { data } = await supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 60)
    if (data?.signedUrl) triggerDownload(data.signedUrl, file.file_name)
  }

  function TypeBadge() {
    const color = isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : null
    const letter = isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null
    if (!color) return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    return <div style={{ width: 34, height: 42, background: color, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#fff', fontSize: 17, fontWeight: 700, fontFamily: 'Arial' }}>{letter}</span></div>
  }

  return (
    <>
      <div draggable={!renaming} style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', fontSize: 12, position: 'relative', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect && onSelect(file.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 120, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onPreview ? onPreview(file, url) : null}>
          {isImg && url
            ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={file.file_name} />
            : <TypeBadge />
          }
          <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>{ext}</div>
        </div>
        <div style={{ padding: '7px 9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            {renaming
              ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                  onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                  style={{ flex: 1, fontSize: 11, padding: '1px 5px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', minWidth: 0 }} />
              : <>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)', flex: 1 }} title={file.file_name}>{file.file_name}</div>
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) }} title="Rename"
                      style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </>
            }
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{fmtSize(file.file_size)}{file.file_size ? ' · ' : ''}{new Date(file.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {url && <button onClick={e => { e.stopPropagation(); onPreview ? onPreview(file, url) : window.open(url, '_blank') }} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
            <button onClick={e => { e.stopPropagation(); download() }} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>
            {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, padding: '3px 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
          </div>
        </div>
      </div>
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDel(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>Delete "{file.file_name}"?</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(false)} style={{ fontSize: 11, lineHeight: '24px', padding: '0 9px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>Cancel</button>
              <button onClick={() => { setConfirmDel(false); onDelete(file) }} style={{ fontSize: 11, lineHeight: '24px', padding: '0 9px', border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── HS File List Row ──────────────────────────────────────────────────────────
function HSFileListRow({ file, onDelete, canDelete, selected, onSelect, onPreview }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const isPdf = /\.pdf$/i.test(file.file_name || '')
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.file_name || '')
  const isWord = /\.docx?$/i.test(file.file_name || '')
  const isExcel = /\.xlsx?$/i.test(file.file_name || '')
  const isPpt = /\.pptx?$/i.test(file.file_name || '')
  const iconColor = isPdf ? '#E24B4A' : isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : isImg ? '#448a40' : '#888'
  const iconLetter = isPdf ? 'PDF' : isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null

  useEffect(() => {
    supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('hs_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  async function download() {
    const { data } = await supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 60)
    if (data?.signedUrl) triggerDownload(data.signedUrl, file.file_name)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: 'var(--surface)', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect && onSelect(file.id) }}
          style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'), background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {selected && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 5, background: iconColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconLetter ? <span style={{ fontSize: 10, fontWeight: 700, color: iconColor }}>{iconLetter}</span>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming
            ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
            : (
              <div onClick={() => onPreview ? onPreview(file, url) : null} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word', lineHeight: '1.3', flex: 1 }}>{file.file_name}</div>
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) }} title="Rename"
                      style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtSize(file.file_size)}</div>
              </div>
            )
          }
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {url && <button onClick={e => { e.stopPropagation(); onPreview ? onPreview(file, url) : window.open(url, '_blank') }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          {url && <button onClick={e => { e.stopPropagation(); download() }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
          {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDel(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>Delete "{file.file_name}"?</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(false)} style={{ fontSize: 11, lineHeight: '24px', padding: '0 9px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>Cancel</button>
              <button onClick={() => { setConfirmDel(false); onDelete(file) }} style={{ fontSize: 11, lineHeight: '24px', padding: '0 9px', border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


function FolderNode({ node, projectId, depth, fileCounts, canManage, canAddFolders, customFolders, onCustomFolderAdded, sectionColor, viewMode = 'grid', setViewMode, onPreview, onDeleteNode, onRenameNode }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [renamingNode, setRenamingNode] = useState(false)
  const [renameNodeVal, setRenameNodeVal] = useState('')
  const [confirmDelNode, setConfirmDelNode] = useState(false)

  const color = node.color || sectionColor || '#888780'
  const bg = node.bg || '#F1EFE8'
  const fileCount = fileCounts?.[node.key] || 0
  const isSection = depth === 0
  const indent = depth * 14

  // Custom sub-folders for this node
  const myCustomFolders = (customFolders || []).filter(f => f.parent_key === node.key)

  useEffect(() => {
    if (open) loadFiles()
  }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('hs_files').select('*')
      .eq('project_id', projectId).eq('folder_key', node.key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }

  async function upload(fileList) {
    if (!fileList.length) return
    const fileArr = Array.from(fileList)
    setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      setUploadProgress(prev => ({ ...prev, current: i }))
      const path = `projects/${projectId}/hs/${node.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('hs-handover').upload(path, file)
      if (!error) {
        await supabase.from('hs_files').insert({ project_id: projectId, folder_key: node.key, storage_path: path, file_name: file.name, file_size: file.size })
      } else { errors.push(file.name) }
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadFiles()
  }

  async function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : node.key
        const key = 'custom-' + (parentKey || node.key) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('hs_folders').insert({ project_id: projectId, parent_key: parentKey || node.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const fKey = path ? keyMap[path] : node.key
        const storagePath = `projects/${projectId}/hs/${fKey}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('hs-handover').upload(storagePath, file)
        if (!error) await supabase.from('hs_files').insert({ project_id: projectId, folder_key: fKey, storage_path: storagePath, file_name: file.name, file_size: file.size })
      }
      onCustomFolderAdded?.(); loadFiles()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) upload(f)
    }
  }

  async function deleteFile(f) {
    await supabase.storage.from('hs-handover').remove([f.storage_path])
    await supabase.from('hs_files').delete().eq('id', f.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function addCustomFolder() {
    if (!newFolderName.trim()) return
    setSavingFolder(true)
    const key = 'custom-' + node.key + '-' + Date.now()
    await supabase.from('hs_folders').insert({ project_id: projectId, parent_key: node.key, folder_key: key, label: newFolderName.trim() })
    onCustomFolderAdded?.({ project_id: projectId, parent_key: node.key, folder_key: key, label: newFolderName.trim() })
    setNewFolderName(''); setShowAddFolder(false); setSavingFolder(false)
  }

  async function zipFolder() {
    // Gather this folder + all descendants across hs_folders + HS_STRUCTURE
    const { data: allCustom } = await supabase.from('hs_folders').select('folder_key, parent_key, label').eq('project_id', projectId)
    // Build a unified map: structure children + custom children, keyed by parent folder_key
    const childrenByParent = {}
    function walkStruct(nodes) {
      (nodes || []).forEach(n => {
        if (n.children && n.children.length) {
          childrenByParent[n.key] = (childrenByParent[n.key] || []).concat(n.children.map(c => ({ folder_key: c.key, label: c.label })))
          walkStruct(n.children)
        }
      })
    }
    walkStruct(HS_STRUCTURE)
    ;(allCustom || []).forEach(cf => {
      if (!cf.parent_key) return
      childrenByParent[cf.parent_key] = (childrenByParent[cf.parent_key] || []).concat([{ folder_key: cf.folder_key, label: cf.label }])
    })
    // BFS descendants of node.key
    const descendants = new Set([node.key])
    const labelByKey = { [node.key]: node.label }
    const parentByKey = {}
    let frontier = [node.key]
    while (frontier.length) {
      const next = []
      for (const k of frontier) {
        for (const child of (childrenByParent[k] || [])) {
          if (!descendants.has(child.folder_key)) {
            descendants.add(child.folder_key)
            labelByKey[child.folder_key] = child.label
            parentByKey[child.folder_key] = k
            next.push(child.folder_key)
          }
        }
      }
      frontier = next
    }
    function pathFor(key) {
      if (key === node.key) return ''
      const parts = []
      let cur = key
      while (cur && cur !== node.key) { parts.unshift(labelByKey[cur] || cur); cur = parentByKey[cur]; if (!cur) break }
      return parts.join('/')
    }
    const { data: allFiles } = await supabase.from('hs_files').select('*').eq('project_id', projectId).in('folder_key', Array.from(descendants))
    if (!allFiles?.length) { alert('No files in this folder.'); return }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.onload = async () => {
      const zip = new window.JSZip()
      const rootFolder = zip.folder(node.label)
      for (const f of allFiles) {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const rel = pathFor(f.folder_key)
          const target = rel ? rootFolder.folder(rel) : rootFolder
          target.file(f.file_name, await resp.blob())
        }
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${node.label}.zip`; a.click()
    }
    document.head.appendChild(script)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = node.label + '-selected.zip'; a.click()
    }
    document.head.appendChild(s)
  }
  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

    const hasChildren = (node.children?.length > 0) || myCustomFolders.length > 0
  const totalCount = fileCount + (node.children || []).reduce((s, c) => s + (fileCounts?.[c.key] || 0), 0)

  return (
    <div style={{ marginLeft: indent > 0 ? 0 : 0 }}>
      <UploadProgress uploadState={uploadProgress} />
      {/* Folder row */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: isSection ? '11px 14px' : '8px 12px',
          borderRadius: isSection ? 8 : 6,
          cursor: 'pointer',
          background: isSection ? 'var(--surface)' : open ? 'var(--surface2)' : 'transparent',
          border: isSection ? `0.5px solid var(--border)` : 'none',
          borderLeft: isSection ? `3px solid ${color}` : depth === 1 ? `2px solid ${color}40` : 'none',
          marginBottom: isSection ? 5 : 2,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isSection && !open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!isSection && !open) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Folder icon */}
        {(() => {
          const IconSvg = isSection ? HS_ICONS[node.key] : null
          const isCustom = node.key.startsWith('custom-')
          const sz = isSection ? 16 : 13
          return (
            <div style={{ width: isSection ? 32 : 24, height: isSection ? 32 : 24, borderRadius: 5, background: isCustom ? '#F1EFE8' : bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {IconSvg
                ? <IconSvg color={color} size={sz} />
                : isCustom
                ? <span style={{ fontSize: 13 }}>📁</span>
                : <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
              }
            </div>
          )
        })()}

        {/* Label */}
        <div style={{ flex: 1, minWidth: 0 }} onClick={e => { if (renamingNode) e.stopPropagation() }}>
          {renamingNode
            ? <input value={renameNodeVal} autoFocus onChange={e => setRenameNodeVal(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    if (renameNodeVal.trim() && renameNodeVal.trim() !== node.label) await onRenameNode?.(node.key, renameNodeVal.trim())
                    setRenamingNode(false)
                  }
                  if (e.key === 'Escape') setRenamingNode(false)
                }}
                onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                style={{ fontSize: isSection ? 13 : 12, fontWeight: isSection ? 600 : 500, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', width: '100%' }} />
            : <div style={{ fontSize: isSection ? 13 : 12, fontWeight: isSection ? 600 : 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</div>
          }
          {totalCount > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{totalCount} file{totalCount !== 1 ? 's' : ''}</div>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {showAddFolder ? (
            <>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Subfolder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addCustomFolder(); if (e.key === 'Escape') { setShowAddFolder(false); setNewFolderName('') } }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 130 }} />
              <button onClick={addCustomFolder} disabled={!newFolderName.trim()} style={BtnG}>{savingFolder ? '...' : 'Add'}</button>
              <button onClick={() => { setShowAddFolder(false); setNewFolderName('') }} style={Btn}>✕</button>
            </>
          ) : (
            <>
              {node.key.startsWith('custom-') && canManage && (
                <>
                  <button onClick={e => { e.stopPropagation(); setRenameNodeVal(node.label); setRenamingNode(true) }} title="Rename folder"
                    style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Rename
                  </button>
                  <button onClick={e => { e.stopPropagation(); setConfirmDelNode(true) }} title="Delete folder"
                    style={{ ...BtnR, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    Delete
                  </button>
                </>
              )}
              <button onClick={zipFolder} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                Zip all
              </button>
              {canAddFolders && (
                <button onClick={() => setShowAddFolder(true)} style={Btn}>+ Subfolder</button>
              )}
              {canManage && (
                <label style={BtnG}>
                  {uploading ? '...' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} disabled={uploading} />
                </label>
              )}
              {open && depth === 0 && setViewMode && <ViewToggle viewMode={viewMode} setView={setViewMode} />}
            </>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {/* Open content */}
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ marginLeft: isSection ? 16 : 12, paddingLeft: 10, borderLeft: `1.5px solid ${color}30`, marginBottom: isSection ? 8 : 4, paddingTop: 4, paddingBottom: 4 }}>
          {/* Sub-folders */}
          {node.children?.map(child => (
            <FolderNode key={child.key} node={child} projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} viewMode={viewMode} setViewMode={setViewMode} onPreview={onPreview}
              onDeleteNode={onDeleteNode} onRenameNode={onRenameNode} />
          ))}

          {/* Custom sub-folders */}
          {myCustomFolders.map(cf => (
            <FolderNode key={cf.folder_key}
              node={{ key: cf.folder_key, label: cf.label, children: [] }}
              projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} viewMode={viewMode} setViewMode={setViewMode} onPreview={onPreview}
              onDeleteNode={onDeleteNode} onRenameNode={onRenameNode} />
          ))}

          {/* Files grid */}
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())}
            onMove={async (targetKey) => {
              for (const id of selected) await supabase.from('hs_files').update({ folder_key: targetKey }).eq('id', id)
              setSelected(new Set()); loadFiles()
            }}
            moveTargets={[
              ...(node.children || []).map(c => ({ key: c.key, label: c.label })),
              ...myCustomFolders.map(cf => ({ key: cf.folder_key, label: cf.label }))
            ]} />
          {files.length > 0 && (
            viewMode === 'list'
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, marginBottom: 8 }}>
                  {files.map(f => <HSFileListRow key={f.id} file={f} onDelete={() => setConfirmDelete(f)} canDelete={canManage} selected={selected.has(f.id)} onSelect={toggleSelect} onPreview={onPreview} />)}
                </div>
              : <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: viewMode === 'compact' ? 6 : 8, marginTop: 8, marginBottom: 8 }}>
                  {files.map(f => <HSFileCard key={f.id} file={f} onDelete={() => setConfirmDelete(f)} canDelete={canManage} selected={selected.has(f.id)} onSelect={toggleSelect} onPreview={onPreview} />)}
                </div>
          )}

          {/* Upload area if no files */}
          {files.length === 0 && !hasChildren && canManage && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11, margin: '4px 0' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files here or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          )}

          {files.length === 0 && !hasChildren && !canManage && (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '8px 0', fontStyle: 'italic' }}>Empty folder</div>
          )}


        </div>
      )}

      {/* Delete this custom node */}
      {confirmDelNode && (
        <ConfirmDlg message={'Delete "' + node.label + '" and all its files? This cannot be undone.'}
          onOk={async () => { setConfirmDelNode(false); await onDeleteNode?.(node.key) }}
          onCancel={() => setConfirmDelNode(false)} />
      )}

      {/* Delete confirm (file) */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete file?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>"{confirmDelete.file_name}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteFile(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main HSHandover component ─────────────────────────────────
export default function HSHandover({ projectId, projectName }) {
  const { can } = useAuth()
  const [fileCounts, setFileCounts] = useState({})
  const [customFolders, setCustomFolders] = useState([])
  const [compilingFull, setCompilingFull] = useState(false)
  const [compilingOm, setCompilingOm] = useState(false)
  const [zippingAll, setZippingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('hsView_' + projectId) || 'grid' } catch { return 'grid' } })
  function setView(mode) { setViewMode(mode); try { localStorage.setItem('hsView_' + projectId, mode) } catch {} }
  function openPreview(file, url) {
    setPreviewFile(file); setPreviewUrl(url || null)
    if (!url) supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600).then(({ data }) => { if (data?.signedUrl) setPreviewUrl(data.signedUrl) })
  }

  const canManage = can('manage_projects')
  const canAddFolders = can('manage_projects')

  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  useEffect(() => {
    loadFileCounts()
    loadCustomFolders()
  }, [projectId])

  async function loadFileCounts() {
    const { data } = await supabase.from('hs_files').select('folder_key').eq('project_id', projectId)
    if (data) {
      const counts = {}
      data.forEach(f => { counts[f.folder_key] = (counts[f.folder_key] || 0) + 1 })
      setFileCounts(counts)
    }
  }

  async function loadCustomFolders() {
    const { data } = await supabase.from('hs_folders').select('*').eq('project_id', projectId).order('created_at')
    setCustomFolders(data || [])
  }

  const totalFiles = Object.values(fileCounts).reduce((a, b) => a + b, 0)

  async function compileHandover(sectionKeys, filename) {
    // Load pdf-lib
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)

    const { PDFDocument, rgb, StandardFonts, PageSizes } = window.PDFLib

    const merged = await PDFDocument.create()
    const boldFont = await merged.embedFont(StandardFonts.HelveticaBold)
    const regFont = await merged.embedFont(StandardFonts.Helvetica)

    // ── Cover page ────────────────────────────────────────────
    const cover = merged.addPage(PageSizes.A4)
    const { width, height } = cover.getSize()

    // Green header bar
    cover.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: rgb(0.267, 0.541, 0.251) })
    cover.drawText('CITY CONSTRUCTION LTD', { x: 40, y: height - 55, size: 22, font: boldFont, color: rgb(1, 1, 1) })
    cover.drawText('cltd.co.uk', { x: 40, y: height - 80, size: 12, font: regFont, color: rgb(0.9, 0.9, 0.9) })

    // Title
    cover.drawText(filename.replace('.pdf', ''), { x: 40, y: height - 200, size: 28, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    cover.drawText(projectName || 'Project', { x: 40, y: height - 240, size: 16, font: regFont, color: rgb(0.4, 0.4, 0.4) })
    cover.drawText(`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, { x: 40, y: height - 270, size: 12, font: regFont, color: rgb(0.5, 0.5, 0.5) })

    // Footer
    cover.drawRectangle({ x: 0, y: 0, width, height: 40, color: rgb(0.267, 0.541, 0.251) })
    cover.drawText('Confidential — City Construction Ltd', { x: 40, y: 14, size: 10, font: regFont, color: rgb(1, 1, 1) })

    // ── Collect all PDF files ─────────────────────────────────
    const query = sectionKeys ? supabase.from('hs_files').select('*').eq('project_id', projectId).in('folder_key', sectionKeys) : supabase.from('hs_files').select('*').eq('project_id', projectId)
    const { data: allFiles } = await query.order('folder_key').order('file_name')

    const pdfFiles = (allFiles || []).filter(f => f.file_name?.toLowerCase().endsWith('.pdf'))
    const otherFiles = (allFiles || []).filter(f => !f.file_name?.toLowerCase().endsWith('.pdf'))

    let currentSection = null

    for (const file of pdfFiles) {
      // Add section divider page if section changed
      const section = HS_STRUCTURE.find(s => file.folder_key.startsWith(s.key))
      if (section && section.key !== currentSection) {
        currentSection = section.key
        const divPage = merged.addPage(PageSizes.A4)
        divPage.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.97, 0.97, 0.97) })
        divPage.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: rgb(0.267, 0.541, 0.251) })
        divPage.drawText(section.label, { x: 40, y: height / 2 + 20, size: 24, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
        divPage.drawText(projectName || '', { x: 40, y: height / 2 - 10, size: 14, font: regFont, color: rgb(0.5, 0.5, 0.5) })
      }

      try {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const bytes = await resp.arrayBuffer()
          const srcDoc = await PDFDocument.load(bytes)
          const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
          pages.forEach(p => merged.addPage(p))
        }
      } catch (e) { console.warn('Could not embed:', file.file_name) }
    }

    // ── Appendix: non-PDF file index ─────────────────────────
    if (otherFiles.length > 0) {
      const appendix = merged.addPage(PageSizes.A4)
      appendix.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: rgb(0.267, 0.541, 0.251) })
      appendix.drawText('Appendix — Additional Files', { x: 40, y: height - 60, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
      appendix.drawText('The following files are included in the project but cannot be embedded in PDF format:', { x: 40, y: height - 90, size: 11, font: regFont, color: rgb(0.4, 0.4, 0.4) })
      let y = height - 130
      for (const f of otherFiles) {
        if (y < 60) break
        appendix.drawText(`• ${f.file_name}`, { x: 50, y, size: 10, font: regFont, color: rgb(0.2, 0.2, 0.2) })
        y -= 18
      }
    }

    const bytes = await merged.save()
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  async function compileFullHandover() {
    setCompilingFull(true)
    try {
      await compileHandover(null, `${projectName || 'Project'} — H&S Handover File.pdf`)
    } catch (e) { alert('Error compiling PDF: ' + e.message) }
    setCompilingFull(false)
  }

  async function compileOmManuals() {
    setCompilingOm(true)
    try {
      // Get all keys under Section 8
      const s8 = HS_STRUCTURE.find(s => s.key === 's8')
      const s8Keys = getAllKeys([s8])
      await compileHandover(s8Keys, `${projectName || 'Project'} — Section 8 O&M Manuals.pdf`)
    } catch (e) { alert('Error compiling PDF: ' + e.message) }
    setCompilingOm(false)
  }

  async function zipAll() {
    setZippingAll(true)
    try {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(script)
      await new Promise(r => script.onload = r)
      const zip = new window.JSZip()

      // Build folder paths from HS_STRUCTURE in memory (no DB dependency)
      const keyToPath = buildPaths(HS_STRUCTURE, '', {})

      // Merge in custom user-created folders
      for (const cf of customFolders) {
        if (!keyToPath[cf.folder_key]) {
          const parentPath = keyToPath[cf.parent_key] || cf.parent_key
          keyToPath[cf.folder_key] = parentPath + '/' + cf.label
        }
      }

      // Add real uploaded files into their correct folders
      const { data: allFiles } = await supabase.from('hs_files').select('*').eq('project_id', projectId)
      const foldersWithFiles = new Set((allFiles || []).map(f => f.folder_key))

      // Create .gitkeep only in folders that have no uploaded files
      for (const [key, path] of Object.entries(keyToPath)) {
        if (!foldersWithFiles.has(key)) {
          zip.file(path + '/.gitkeep', '')
        }
      }

      // Add real uploaded files into their correct folders
      for (const f of (allFiles || [])) {
        const folderPath = keyToPath[f.folder_key] || f.folder_key
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          try {
            const res = await fetch(data.signedUrl)
            zip.folder(folderPath).file(f.file_name, await res.blob())
          } catch {}
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (projectName || 'project') + '-hs-handover.zip'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { alert('Zip failed: ' + e.message) }
    setZippingAll(false)
  }


  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>H&S Handover File</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalFiles} file{totalFiles !== 1 ? 's' : ''} · Sections 1–11</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={zipAll} disabled={zippingAll} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            {zippingAll ? 'Zipping...' : 'Zip all files'}
          </button>
          <button onClick={compileOmManuals} disabled={compilingOm} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid #534AB7', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#534AB7', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {compilingOm ? 'Compiling...' : 'Export Section 8 O&M PDF'}
          </button>
          <button onClick={compileFullHandover} disabled={compilingFull} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: '#448a40', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {compilingFull ? 'Compiling...' : 'Compile Full H&S Handover PDF'}
          </button>
        </div>
      </div>

      {/* Section folders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {HS_STRUCTURE.map(section => (
          <FolderNode
            key={section.key}
            node={section}
            projectId={projectId}
            depth={0}
            fileCounts={fileCounts}
            canManage={canManage}
            canAddFolders={canAddFolders}
            customFolders={customFolders}
            onCustomFolderAdded={() => { loadCustomFolders(); loadFileCounts() }}
            sectionColor={section.color}
            viewMode={viewMode} setViewMode={setView} onPreview={openPreview}
            onDeleteNode={async (key) => {
              if (!window.confirm('Delete this folder and ALL its files?')) return
              await supabase.from('hs_files').delete().eq('project_id', projectId).eq('folder_key', key)
              await supabase.from('hs_folders').delete().eq('folder_key', key).eq('project_id', projectId)
              setCustomFolders(prev => prev.filter(f => f.folder_key !== key))
            }}
            onRenameNode={async (key, label) => {
              await supabase.from('hs_folders').update({ label }).eq('folder_key', key).eq('project_id', projectId)
              setCustomFolders(prev => prev.map(f => f.folder_key === key ? { ...f, label } : f))
            }}
          />
        ))}
      </div>

      {/* Note */}
      <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--text3)' }}>
        Template structure fixed — add sub-folders within sections as needed per project. Only PDFs are embedded in compiled exports; other file types appear in the appendix index.
      </div>

      {/* Preview modal */}
      {previewFile && (
        /\.xlsx?$/i.test(previewFile.file_name)
          ? <ExcelPreview url={previewUrl} fileName={previewFile.file_name}
              onClose={() => setPreviewFile(null)}
              onDownload={previewUrl ? () => triggerDownload(previewUrl, previewFile.file_name) : null} />
          : <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewFile(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewFile.file_name) }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
            <button onClick={() => setPreviewFile(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewFile.file_name}</div>
          {previewUrl ? (
            /\.(jpg|jpeg|png|gif|webp)$/i.test(previewFile.file_name)
              ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : /\.pdf$/i.test(previewFile.file_name)
              ? <iframe src={previewUrl} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8 }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading preview...</div>
          )}
        </div>
      )}
    </div>
  )
}
