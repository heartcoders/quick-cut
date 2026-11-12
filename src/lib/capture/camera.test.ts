import { describe, expect, it } from 'vitest'
import { classifyCamera, lensesFor, type CameraDevice } from './camera'

function devices(labels: string[]): CameraDevice[] {
  return labels.map((label, i) => ({ id: `id${i}`, label, ...classifyCamera(label) }))
}

describe('classifyCamera', () => {
  it.each([
    ['Frontkamera', 'user', 'wide', false],
    ['Rückkamera', 'environment', 'wide', false],
    ['Rückseitige Ultraweitwinkelkamera', 'environment', 'ultra', false],
    ['Rückseitige Teleobjektivkamera', 'environment', 'tele', false],
    ['Rückseitige Dual-Weitwinkelkamera', 'environment', 'wide', true],
    ['Rückseitige Triple-Kamera', 'environment', 'wide', true],
    ['Front Camera', 'user', 'wide', false],
    ['Back Ultra Wide Camera', 'environment', 'ultra', false],
    ['Back Telephoto Camera', 'environment', 'tele', false],
    ['Back Dual Camera', 'environment', 'wide', true],
    ['camera2 1, facing front', 'user', 'wide', false],
    ['FaceTime HD Camera', null, 'wide', false],
  ] as const)('%s', (label, facing, lens, virtual) => {
    expect(classifyCamera(label)).toEqual({ facing, lens, virtual })
  })
})

describe('lensesFor', () => {
  const iphonePro = devices([
    'Frontkamera',
    'Rückseitige Triple-Kamera',
    'Rückseitige Dual-Weitwinkelkamera',
    'Rückseitige Teleobjektivkamera',
    'Rückkamera',
    'Rückseitige Ultraweitwinkelkamera',
  ])

  it('sortiert Rückseite weit → tele und lässt virtuelle Kameras weg', () => {
    expect(lensesFor(iphonePro, 'environment').map((d) => d.label)).toEqual([
      'Rückseitige Ultraweitwinkelkamera',
      'Rückkamera',
      'Rückseitige Teleobjektivkamera',
    ])
  })

  it('Vorderseite hat nur ein Objektiv', () => {
    expect(lensesFor(iphonePro, 'user').map((d) => d.label)).toEqual(['Frontkamera'])
  })
})
