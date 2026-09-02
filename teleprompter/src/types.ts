export interface Script {
  id: string
  title: string
  body: string
  updatedAt: number
}

export interface Settings {
  /** scroll speed in CSS pixels per second */
  speed: number
  /** prompt text size in px */
  fontSize: number
  /** unitless line-height multiplier */
  lineHeight: number
  /** max width of the text column in px */
  textWidth: number
  /** horizontal mirror for beam-splitter glass */
  mirror: boolean
  /** camera layer opacity, 0..1 */
  cameraOpacity: number
  /** reading line position as a fraction of viewport height, 0..1 */
  markerPos: number
}
