export interface Root {
  responseContext: ResponseContext
  trackingParams: string
  onResponseReceivedActions: OnResponseReceivedAction[]
  frameworkUpdates: FrameworkUpdates
}

export interface ResponseContext {
  serviceTrackingParams: ServiceTrackingParam[]
  maxAgeSeconds: number
  mainAppWebResponseContext: MainAppWebResponseContext
  responseId: string
  webResponseContextExtensionData: WebResponseContextExtensionData
}

export interface ServiceTrackingParam {
  service: string
  params: Param[]
}

export interface Param {
  key: string
  value: string
}

export interface MainAppWebResponseContext {
  loggedOut: boolean
  trackingParam: string
}

export interface WebResponseContextExtensionData {
  webResponseContextPreloadData: WebResponseContextPreloadData
  hasDecorated: boolean
}

export interface WebResponseContextPreloadData {
  preloadMessageNames: string[]
}

export interface OnResponseReceivedAction {
  clickTrackingParams: string
  appendContinuationItemsAction?: AppendContinuationItemsAction
  adsControlFlowOpportunityReceivedCommand?: AdsControlFlowOpportunityReceivedCommand
}

export interface AppendContinuationItemsAction {
  continuationItems: ContinuationItem[]
  targetId: string
}

export interface ContinuationItem {
  richItemRenderer?: RichItemRenderer
  richSectionRenderer?: RichSectionRenderer
  continuationItemRenderer?: ContinuationItemRenderer
}

export interface RichItemRenderer {
  content: Content
  trackingParams: string
  onFocusEffect: OnFocusEffect
}

export interface Content {
  lockupViewModel?: LockupViewModel
  adSlotRenderer?: AdSlotRenderer
}

export interface LockupViewModel {
  contentImage: ContentImage
  metadata: Metadata
  contentId: string
  contentType: string
  itemPlayback: ItemPlayback
  rendererContext: RendererContext5
}

export interface ContentImage {
  thumbnailViewModel: ThumbnailViewModel
}

export interface ThumbnailViewModel {
  image: Image
  overlays: Overlay[]
}

export interface Image {
  sources: Source[]
}

export interface Source {
  url: string
  width: number
  height: number
}

export interface Overlay {
  thumbnailBottomOverlayViewModel?: ThumbnailBottomOverlayViewModel
  thumbnailHoverOverlayToggleActionsViewModel?: ThumbnailHoverOverlayToggleActionsViewModel
}

export interface ThumbnailBottomOverlayViewModel {
  badges: Badge[]
}

export interface Badge {
  thumbnailBadgeViewModel: ThumbnailBadgeViewModel
}

export interface ThumbnailBadgeViewModel {
  text: string
  badgeStyle: string
  animationActivationTargetId: string
  animationActivationEntityKey: string
  lottieData: LottieData
  animatedText: string
  animationActivationEntitySelectorType: string
  rendererContext?: RendererContext
  icon?: Icon
  inlinePlaybackBadgeData?: InlinePlaybackBadgeData
}

export interface LottieData {
  url: string
  settings: Settings
}

export interface Settings {
  loop: boolean
  autoplay: boolean
}

export interface RendererContext {
  accessibilityContext: AccessibilityContext
}

export interface AccessibilityContext {
  label: string
}

export interface Icon {
  sources: Source2[]
}

export interface Source2 {
  clientResource: ClientResource
}

export interface ClientResource {
  imageName: string
}

export interface InlinePlaybackBadgeData {
  replicateAsTimestamp: boolean
}

export interface ThumbnailHoverOverlayToggleActionsViewModel {
  buttons: Button[]
}

export interface Button {
  toggleButtonViewModel: ToggleButtonViewModel
}

export interface ToggleButtonViewModel {
  defaultButtonViewModel: DefaultButtonViewModel
  toggledButtonViewModel: ToggledButtonViewModel
  isToggled: boolean
  trackingParams: string
}

export interface DefaultButtonViewModel {
  buttonViewModel: ButtonViewModel
}

export interface ButtonViewModel {
  iconName: string
  onTap: OnTap
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface OnTap {
  innertubeCommand: InnertubeCommand
}

export interface InnertubeCommand {
  clickTrackingParams: string
  commandMetadata: CommandMetadata
  playlistEditEndpoint?: PlaylistEditEndpoint
  signalServiceEndpoint?: SignalServiceEndpoint
}

export interface CommandMetadata {
  webCommandMetadata: WebCommandMetadata
}

export interface WebCommandMetadata {
  sendPost: boolean
  apiUrl?: string
}

export interface PlaylistEditEndpoint {
  playlistId: string
  actions: Action[]
}

export interface Action {
  addedVideoId: string
  action: string
}

export interface SignalServiceEndpoint {
  signal: string
  actions: Action2[]
}

export interface Action2 {
  clickTrackingParams: string
  addToPlaylistCommand: AddToPlaylistCommand
}

export interface AddToPlaylistCommand {
  openMiniplayer: boolean
  videoId: string
  listType: string
  onCreateListCommand: OnCreateListCommand
  videoIds: string[]
  videoCommand: VideoCommand
}

export interface OnCreateListCommand {
  clickTrackingParams: string
  commandMetadata: CommandMetadata2
  createPlaylistServiceEndpoint: CreatePlaylistServiceEndpoint
}

export interface CommandMetadata2 {
  webCommandMetadata: WebCommandMetadata2
}

export interface WebCommandMetadata2 {
  sendPost: boolean
  apiUrl: string
}

export interface CreatePlaylistServiceEndpoint {
  videoIds: string[]
  params: string
}

export interface VideoCommand {
  clickTrackingParams: string
  commandMetadata: CommandMetadata3
  watchEndpoint: WatchEndpoint
}

export interface CommandMetadata3 {
  webCommandMetadata: WebCommandMetadata3
}

export interface WebCommandMetadata3 {
  url: string
  webPageType: string
  rootVe: number
}

export interface WatchEndpoint {
  videoId: string
  playerParams?: string
  ustreamerConfig?: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig
}

export interface WatchEndpointSupportedOnesieConfig {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig
}

export interface Html5PlaybackOnesieConfig {
  commonConfig: CommonConfig
}

export interface CommonConfig {
  url: string
}

export interface ToggledButtonViewModel {
  buttonViewModel: ButtonViewModel2
}

export interface ButtonViewModel2 {
  iconName: string
  onTap?: OnTap2
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface OnTap2 {
  innertubeCommand: InnertubeCommand2
}

export interface InnertubeCommand2 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata4
  playlistEditEndpoint: PlaylistEditEndpoint2
}

export interface CommandMetadata4 {
  webCommandMetadata: WebCommandMetadata4
}

export interface WebCommandMetadata4 {
  sendPost: boolean
  apiUrl: string
}

export interface PlaylistEditEndpoint2 {
  playlistId: string
  actions: Action3[]
}

export interface Action3 {
  action: string
  removedVideoId: string
}

export interface Metadata {
  lockupMetadataViewModel: LockupMetadataViewModel
}

export interface LockupMetadataViewModel {
  title: Title
  image: Image2
  metadata: Metadata2
  menuButton: MenuButton
}

export interface Title {
  content: string
}

export interface Image2 {
  decoratedAvatarViewModel: DecoratedAvatarViewModel
}

export interface DecoratedAvatarViewModel {
  avatar: Avatar
  a11yLabel: string
  rendererContext: RendererContext2
  liveData?: LiveData
}

export interface Avatar {
  avatarViewModel: AvatarViewModel
}

export interface AvatarViewModel {
  image: Image3
  avatarImageSize: string
}

export interface Image3 {
  sources: Source3[]
}

export interface Source3 {
  url: string
  width: number
  height: number
}

export interface RendererContext2 {
  commandContext: CommandContext
  loggingContext?: LoggingContext
  accessibilityContext?: AccessibilityContext2
}

export interface CommandContext {
  onTap: OnTap3
}

export interface OnTap3 {
  innertubeCommand: InnertubeCommand3
}

export interface InnertubeCommand3 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata5
  browseEndpoint?: BrowseEndpoint
  watchEndpoint?: WatchEndpoint2
}

export interface CommandMetadata5 {
  webCommandMetadata: WebCommandMetadata5
}

export interface WebCommandMetadata5 {
  url: string
  webPageType: string
  rootVe: number
  apiUrl?: string
}

export interface BrowseEndpoint {
  browseId: string
  canonicalBaseUrl: string
}

export interface WatchEndpoint2 {
  videoId: string
  playerParams: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig2
}

export interface WatchEndpointSupportedOnesieConfig2 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig2
}

export interface Html5PlaybackOnesieConfig2 {
  commonConfig: CommonConfig2
}

export interface CommonConfig2 {
  url: string
}

export interface LoggingContext {
  loggingDirectives: LoggingDirectives
}

export interface LoggingDirectives {
  trackingParams: string
  visibility: Visibility
}

export interface Visibility {
  types: string
}

export interface AccessibilityContext2 {
  label: string
}

export interface LiveData {
  liveBadgeText: string
}

export interface Metadata2 {
  contentMetadataViewModel: ContentMetadataViewModel
}

export interface ContentMetadataViewModel {
  metadataRows: MetadataRow[]
  delimiter: string
}

export interface MetadataRow {
  metadataParts?: MetadataPart[]
  badges?: Badge2[]
}

export interface MetadataPart {
  text: Text
}

export interface Text {
  content: string
  commandRuns?: CommandRun[]
  styleRuns?: StyleRun[]
  attachmentRuns?: AttachmentRun[]
}

export interface CommandRun {
  startIndex: number
  length: number
  onTap: OnTap4
}

export interface OnTap4 {
  innertubeCommand: InnertubeCommand4
}

export interface InnertubeCommand4 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata6
  browseEndpoint: BrowseEndpoint2
}

export interface CommandMetadata6 {
  webCommandMetadata: WebCommandMetadata6
}

export interface WebCommandMetadata6 {
  url: string
  webPageType: string
  rootVe: number
  apiUrl: string
}

export interface BrowseEndpoint2 {
  browseId: string
  canonicalBaseUrl: string
}

export interface StyleRun {
  startIndex: number
  length?: number
  weightLabel?: string
  styleRunExtensions?: StyleRunExtensions
}

export interface StyleRunExtensions {
  styleRunColorMapExtension: StyleRunColorMapExtension
}

export interface StyleRunColorMapExtension {
  colorMap: ColorMap[]
}

export interface ColorMap {
  key: string
  value: number
}

export interface AttachmentRun {
  startIndex: number
  length: number
  element: Element
  alignment: string
}

export interface Element {
  type: Type
  properties: Properties
}

export interface Type {
  imageType: ImageType
}

export interface ImageType {
  image: Image4
}

export interface Image4 {
  sources: Source4[]
}

export interface Source4 {
  clientResource: ClientResource2
  width: number
  height: number
}

export interface ClientResource2 {
  imageName: string
}

export interface Properties {
  layoutProperties: LayoutProperties
}

export interface LayoutProperties {
  height: Height
  width: Width
  margin: Margin
}

export interface Height {
  value: number
  unit: string
}

export interface Width {
  value: number
  unit: string
}

export interface Margin {
  left: Left
}

export interface Left {
  value: number
  unit: string
}

export interface Badge2 {
  badgeViewModel: BadgeViewModel
}

export interface BadgeViewModel {
  badgeText: string
  badgeStyle: string
  trackingParams: string
  iconName: string
}

export interface MenuButton {
  buttonViewModel: ButtonViewModel3
}

export interface ButtonViewModel3 {
  iconName: string
  onTap: OnTap5
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface OnTap5 {
  innertubeCommand: InnertubeCommand5
}

export interface InnertubeCommand5 {
  clickTrackingParams: string
  showSheetCommand: ShowSheetCommand
}

export interface ShowSheetCommand {
  panelLoadingStrategy: PanelLoadingStrategy
}

export interface PanelLoadingStrategy {
  inlineContent: InlineContent
}

export interface InlineContent {
  sheetViewModel: SheetViewModel
}

export interface SheetViewModel {
  content: Content2
}

export interface Content2 {
  listViewModel: ListViewModel
}

export interface ListViewModel {
  listItems: ListItem[]
}

export interface ListItem {
  listItemViewModel?: ListItemViewModel
  downloadListItemViewModel?: DownloadListItemViewModel
}

export interface ListItemViewModel {
  title: Title2
  leadingImage: LeadingImage
  rendererContext: RendererContext3
}

export interface Title2 {
  content: string
}

export interface LeadingImage {
  sources: Source5[]
}

export interface Source5 {
  clientResource: ClientResource3
}

export interface ClientResource3 {
  imageName: string
}

export interface RendererContext3 {
  commandContext: CommandContext2
  loggingContext?: LoggingContext2
}

export interface CommandContext2 {
  onTap: OnTap6
}

export interface OnTap6 {
  innertubeCommand: InnertubeCommand6
}

export interface InnertubeCommand6 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata7
  shareEntityServiceEndpoint?: ShareEntityServiceEndpoint
  signalServiceEndpoint?: SignalServiceEndpoint2
  signInEndpoint?: SignInEndpoint
}

export interface CommandMetadata7 {
  webCommandMetadata: WebCommandMetadata7
}

export interface WebCommandMetadata7 {
  sendPost?: boolean
  apiUrl?: string
  url?: string
  webPageType?: string
  rootVe?: number
}

export interface ShareEntityServiceEndpoint {
  serializedShareEntity: string
  commands: Command[]
}

export interface Command {
  clickTrackingParams: string
  openPopupAction: OpenPopupAction
}

export interface OpenPopupAction {
  popup: Popup
  popupType: string
  beReused: boolean
}

export interface Popup {
  unifiedSharePanelRenderer: UnifiedSharePanelRenderer
}

export interface UnifiedSharePanelRenderer {
  trackingParams: string
  showLoadingSpinner: boolean
}

export interface SignalServiceEndpoint2 {
  signal: string
  actions: Action4[]
}

export interface Action4 {
  clickTrackingParams: string
  addToPlaylistCommand: AddToPlaylistCommand2
}

export interface AddToPlaylistCommand2 {
  openMiniplayer: boolean
  videoId: string
  listType: string
  onCreateListCommand: OnCreateListCommand2
  videoIds: string[]
  videoCommand: VideoCommand2
}

export interface OnCreateListCommand2 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata8
  createPlaylistServiceEndpoint: CreatePlaylistServiceEndpoint2
}

export interface CommandMetadata8 {
  webCommandMetadata: WebCommandMetadata8
}

export interface WebCommandMetadata8 {
  sendPost: boolean
  apiUrl: string
}

export interface CreatePlaylistServiceEndpoint2 {
  videoIds: string[]
  params: string
}

export interface VideoCommand2 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata9
  watchEndpoint: WatchEndpoint3
}

export interface CommandMetadata9 {
  webCommandMetadata: WebCommandMetadata9
}

export interface WebCommandMetadata9 {
  url: string
  webPageType: string
  rootVe: number
}

export interface WatchEndpoint3 {
  videoId: string
  playerParams?: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig3
}

export interface WatchEndpointSupportedOnesieConfig3 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig3
}

export interface Html5PlaybackOnesieConfig3 {
  commonConfig: CommonConfig3
}

export interface CommonConfig3 {
  url: string
}

export interface SignInEndpoint {
  nextEndpoint: NextEndpoint
}

export interface NextEndpoint {
  clickTrackingParams: string
  showSheetCommand: ShowSheetCommand2
}

export interface ShowSheetCommand2 {
  panelLoadingStrategy: PanelLoadingStrategy2
}

export interface PanelLoadingStrategy2 {
  requestTemplate: RequestTemplate
}

export interface RequestTemplate {
  panelId: string
  params: string
}

export interface LoggingContext2 {
  loggingDirectives: LoggingDirectives2
}

export interface LoggingDirectives2 {
  trackingParams: string
  visibility: Visibility2
}

export interface Visibility2 {
  types: string
}

export interface DownloadListItemViewModel {
  rendererContext: RendererContext4
}

export interface RendererContext4 {
  loggingContext: LoggingContext3
  commandContext: CommandContext3
}

export interface LoggingContext3 {
  loggingDirectives: LoggingDirectives3
}

export interface LoggingDirectives3 {
  trackingParams: string
  visibility: Visibility3
}

export interface Visibility3 {
  types: string
}

export interface CommandContext3 {
  onTap: OnTap7
}

export interface OnTap7 {
  innertubeCommand: InnertubeCommand7
}

export interface InnertubeCommand7 {
  clickTrackingParams: string
  offlineVideoEndpoint: OfflineVideoEndpoint
}

export interface OfflineVideoEndpoint {
  videoId: string
  onAddCommand: OnAddCommand
}

export interface OnAddCommand {
  clickTrackingParams: string
  getDownloadActionCommand: GetDownloadActionCommand
}

export interface GetDownloadActionCommand {
  videoId: string
  params: string
  isCrossDeviceDownload: boolean
}

export interface ItemPlayback {
  inlinePlayerData: InlinePlayerData
}

export interface InlinePlayerData {
  onSelect: OnSelect
  onVisible: OnVisible
}

export interface OnSelect {
  innertubeCommand: InnertubeCommand8
}

export interface InnertubeCommand8 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata10
  watchEndpoint: WatchEndpoint4
}

export interface CommandMetadata10 {
  webCommandMetadata: WebCommandMetadata10
}

export interface WebCommandMetadata10 {
  url: string
  webPageType: string
  rootVe: number
}

export interface WatchEndpoint4 {
  videoId: string
  playerParams?: string
  ustreamerConfig?: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig4
  playlistId?: string
  params?: string
  loggingContext?: LoggingContext4
}

export interface WatchEndpointSupportedOnesieConfig4 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig4
}

export interface Html5PlaybackOnesieConfig4 {
  commonConfig: CommonConfig4
}

export interface CommonConfig4 {
  url: string
}

export interface LoggingContext4 {
  vssLoggingContext: VssLoggingContext
}

export interface VssLoggingContext {
  serializedContextData: string
}

export interface OnVisible {
  innertubeCommand: InnertubeCommand9
}

export interface InnertubeCommand9 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata11
  watchEndpoint: WatchEndpoint5
}

export interface CommandMetadata11 {
  webCommandMetadata: WebCommandMetadata11
}

export interface WebCommandMetadata11 {
  url: string
  webPageType: string
  rootVe: number
}

export interface WatchEndpoint5 {
  videoId: string
  playerParams: string
  playerExtraUrlParams: PlayerExtraUrlParam[]
  ustreamerConfig?: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig5
}

export interface PlayerExtraUrlParam {
  key: string
  value: string
}

export interface WatchEndpointSupportedOnesieConfig5 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig5
}

export interface Html5PlaybackOnesieConfig5 {
  commonConfig: CommonConfig5
}

export interface CommonConfig5 {
  url: string
}

export interface RendererContext5 {
  loggingContext: LoggingContext5
  accessibilityContext: AccessibilityContext3
  commandContext: CommandContext4
}

export interface LoggingContext5 {
  loggingDirectives: LoggingDirectives4
}

export interface LoggingDirectives4 {
  trackingParams: string
  visibility: Visibility4
}

export interface Visibility4 {
  types: string
}

export interface AccessibilityContext3 {
  label: string
}

export interface CommandContext4 {
  onTap: OnTap8
}

export interface OnTap8 {
  innertubeCommand: InnertubeCommand10
}

export interface InnertubeCommand10 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata12
  watchEndpoint: WatchEndpoint6
}

export interface CommandMetadata12 {
  webCommandMetadata: WebCommandMetadata12
}

export interface WebCommandMetadata12 {
  url: string
  webPageType: string
  rootVe: number
}

export interface WatchEndpoint6 {
  videoId: string
  playerParams?: string
  ustreamerConfig?: string
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig6
  playlistId?: string
  params?: string
  loggingContext?: LoggingContext6
}

export interface WatchEndpointSupportedOnesieConfig6 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig6
}

export interface Html5PlaybackOnesieConfig6 {
  commonConfig: CommonConfig6
}

export interface CommonConfig6 {
  url: string
}

export interface LoggingContext6 {
  vssLoggingContext: VssLoggingContext2
}

export interface VssLoggingContext2 {
  serializedContextData: string
}

export interface AdSlotRenderer {
  adSlotMetadata: AdSlotMetadata
  fulfillmentContent: FulfillmentContent
  enablePacfLoggingWeb: boolean
  trackingParams: string
}

export interface AdSlotMetadata {
  slotId: string
  slotType: string
  slotPhysicalPosition: number
  adSlotLoggingData: AdSlotLoggingData
}

export interface AdSlotLoggingData {
  serializedSlotAdServingDataEntry: string
}

export interface FulfillmentContent {
  fulfilledLayout: FulfilledLayout
}

export interface FulfilledLayout {
  inFeedAdLayoutRenderer: InFeedAdLayoutRenderer
}

export interface InFeedAdLayoutRenderer {
  adLayoutMetadata: AdLayoutMetadata
  renderingContent: RenderingContent
}

export interface AdLayoutMetadata {
  layoutId: string
  layoutType: string
  adLayoutLoggingData: AdLayoutLoggingData
}

export interface AdLayoutLoggingData {
  serializedAdServingDataEntry: string
}

export interface RenderingContent {
  topLandscapeImageLayoutViewModel: TopLandscapeImageLayoutViewModel
}

export interface TopLandscapeImageLayoutViewModel {
  interaction: Interaction
  adLayoutData: AdLayoutData
  thumbnailImage: ThumbnailImage
  feedAdMetadata: FeedAdMetadata
  adButtonHoverOverlay: AdButtonHoverOverlay
  loggingDirectives: LoggingDirectives14
}

export interface Interaction {
  onTap: OnTap9
  onFirstVisible: OnFirstVisible
}

export interface OnTap9 {
  innertubeCommand: InnertubeCommand11
}

export interface InnertubeCommand11 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata13
  urlEndpoint: UrlEndpoint
}

export interface CommandMetadata13 {
  webCommandMetadata: WebCommandMetadata13
}

export interface WebCommandMetadata13 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint {
  url: string
  target: string
  attributionSrcMode: string
}

export interface OnFirstVisible {
  performOnceCommand: PerformOnceCommand
}

export interface PerformOnceCommand {
  identifier: string
  command: Command2
}

export interface Command2 {
  innertubeCommand: InnertubeCommand12
}

export interface InnertubeCommand12 {
  loggingUrls: LoggingUrl[]
  pingingEndpoint: PingingEndpoint
}

export interface LoggingUrl {
  baseUrl: string
}

export interface PingingEndpoint {
  hack: boolean
}

export interface AdLayoutData {
  activeViewData: ActiveViewData
}

export interface ActiveViewData {
  viewableCommand: ViewableCommand
  endOfSessionCommand: EndOfSessionCommand
  regexUriMacroValidator: RegexUriMacroValidator
  identifier: string
}

export interface ViewableCommand {
  innertubeCommand: InnertubeCommand13
}

export interface InnertubeCommand13 {
  clickTrackingParams: string
  loggingUrls: LoggingUrl2[]
  pingingEndpoint: PingingEndpoint2
}

export interface LoggingUrl2 {
  baseUrl: string
}

export interface PingingEndpoint2 {
  hack: boolean
}

export interface EndOfSessionCommand {
  innertubeCommand: InnertubeCommand14
}

export interface InnertubeCommand14 {
  clickTrackingParams: string
  loggingUrls: LoggingUrl3[]
  pingingEndpoint: PingingEndpoint3
}

export interface LoggingUrl3 {
  baseUrl: string
}

export interface PingingEndpoint3 {
  hack: boolean
}

export interface RegexUriMacroValidator {
  emptyMap: boolean
}

export interface ThumbnailImage {
  adImageViewModel: AdImageViewModel
}

export interface AdImageViewModel {
  interaction: Interaction2
  imageSources: ImageSource[]
  imageProperties: ImageProperties
  background: Background
  loggingDirectives: LoggingDirectives5
}

export interface Interaction2 {
  onTap: OnTap10
}

export interface OnTap10 {
  innertubeCommand: InnertubeCommand15
}

export interface InnertubeCommand15 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata14
  urlEndpoint: UrlEndpoint2
}

export interface CommandMetadata14 {
  webCommandMetadata: WebCommandMetadata14
}

export interface WebCommandMetadata14 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint2 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface ImageSource {
  url: string
  width: number
  height: number
}

export interface ImageProperties {
  contentMode: string
  renderingAspect: string
}

export interface Background {
  backgroundImageSource: BackgroundImageSource
}

export interface BackgroundImageSource {
  imageSources: ImageSource2[]
}

export interface ImageSource2 {
  url: string
  width: number
  height: number
}

export interface LoggingDirectives5 {
  trackingParams: string
  visibility: Visibility5
}

export interface Visibility5 {
  types: string
}

export interface FeedAdMetadata {
  feedAdMetadataViewModel: FeedAdMetadataViewModel
}

export interface FeedAdMetadataViewModel {
  interaction: Interaction3
  style: string
  headline: Headline
  description: Description
  adBadge: AdBadge
  adDetailsLine: AdDetailsLine
  menu: Menu
  adRenderingContextType: string
  loggingDirectives: LoggingDirectives11
}

export interface Interaction3 {
  onTap: OnTap11
}

export interface OnTap11 {
  innertubeCommand: InnertubeCommand16
}

export interface InnertubeCommand16 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata15
  urlEndpoint: UrlEndpoint3
}

export interface CommandMetadata15 {
  webCommandMetadata: WebCommandMetadata15
}

export interface WebCommandMetadata15 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint3 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Headline {
  content: string
  commandRuns: CommandRun2[]
}

export interface CommandRun2 {
  loggingDirectives?: LoggingDirectives6
  onTap?: OnTap12
}

export interface LoggingDirectives6 {
  trackingParams: string
}

export interface OnTap12 {
  innertubeCommand: InnertubeCommand17
}

export interface InnertubeCommand17 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata16
  urlEndpoint: UrlEndpoint4
}

export interface CommandMetadata16 {
  webCommandMetadata: WebCommandMetadata16
}

export interface WebCommandMetadata16 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint4 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Description {
  content: string
  commandRuns: CommandRun3[]
}

export interface CommandRun3 {
  loggingDirectives?: LoggingDirectives7
  onTap?: OnTap13
}

export interface LoggingDirectives7 {
  trackingParams: string
}

export interface OnTap13 {
  innertubeCommand: InnertubeCommand18
}

export interface InnertubeCommand18 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata17
  urlEndpoint: UrlEndpoint5
}

export interface CommandMetadata17 {
  webCommandMetadata: WebCommandMetadata17
}

export interface WebCommandMetadata17 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint5 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface AdBadge {
  adBadgeViewModel: AdBadgeViewModel
}

export interface AdBadgeViewModel {
  interaction: Interaction4
  style: string
  label: Label
  loggingDirectives: LoggingDirectives8
}

export interface Interaction4 {
  onTap: OnTap14
}

export interface OnTap14 {
  innertubeCommand: InnertubeCommand19
}

export interface InnertubeCommand19 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata18
  urlEndpoint: UrlEndpoint6
}

export interface CommandMetadata18 {
  webCommandMetadata: WebCommandMetadata18
}

export interface WebCommandMetadata18 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint6 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Label {
  content: string
}

export interface LoggingDirectives8 {
  trackingParams: string
  visibility: Visibility6
}

export interface Visibility6 {
  types: string
}

export interface AdDetailsLine {
  adDetailsLineViewModel: AdDetailsLineViewModel
}

export interface AdDetailsLineViewModel {
  interaction: Interaction5
  style: string
  attributes: Attribute[]
  loggingDirectives: LoggingDirectives9
}

export interface Interaction5 {
  onTap: OnTap15
}

export interface OnTap15 {
  innertubeCommand: InnertubeCommand20
}

export interface InnertubeCommand20 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata19
  urlEndpoint: UrlEndpoint7
}

export interface CommandMetadata19 {
  webCommandMetadata: WebCommandMetadata19
}

export interface WebCommandMetadata19 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint7 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Attribute {
  text: Text2
}

export interface Text2 {
  content: string
}

export interface LoggingDirectives9 {
  trackingParams: string
  visibility: Visibility7
}

export interface Visibility7 {
  types: string
}

export interface Menu {
  buttonViewModel: ButtonViewModel4
}

export interface ButtonViewModel4 {
  iconName: string
  onTap: OnTap16
  accessibilityText: string
  style: string
  trackingParams: string
  buttonSize: string
  state: string
  tooltip: string
  loggingDirectives: LoggingDirectives10
}

export interface OnTap16 {
  innertubeCommand: InnertubeCommand21
}

export interface InnertubeCommand21 {
  clickTrackingParams: string
  openPopupAction: OpenPopupAction2
}

export interface OpenPopupAction2 {
  popup: Popup2
  popupType: string
  accessibilityData: AccessibilityData
}

export interface Popup2 {
  aboutThisAdRenderer: AboutThisAdRenderer
}

export interface AboutThisAdRenderer {
  url: Url
  trackingParams: string
}

export interface Url {
  privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string
}

export interface AccessibilityData {
  accessibilityData: AccessibilityData2
}

export interface AccessibilityData2 {
  label: string
}

export interface LoggingDirectives10 {
  trackingParams: string
  visibility: Visibility8
  attentionLogging: string
}

export interface Visibility8 {
  types: string
}

export interface LoggingDirectives11 {
  trackingParams: string
  visibility: Visibility9
}

export interface Visibility9 {
  types: string
}

export interface AdButtonHoverOverlay {
  adButtonHoverOverlayViewModel: AdButtonHoverOverlayViewModel
}

export interface AdButtonHoverOverlayViewModel {
  interaction: Interaction6
  button: Button2
  loggingDirectives: LoggingDirectives13
}

export interface Interaction6 {
  onTap: OnTap17
}

export interface OnTap17 {
  innertubeCommand: InnertubeCommand22
}

export interface InnertubeCommand22 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata20
  urlEndpoint: UrlEndpoint8
}

export interface CommandMetadata20 {
  webCommandMetadata: WebCommandMetadata20
}

export interface WebCommandMetadata20 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint8 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Button2 {
  adButtonViewModel: AdButtonViewModel
}

export interface AdButtonViewModel {
  interaction: Interaction7
  style: string
  size: string
  label: Label2
  trackingParams: string
  iconImage: IconImage
  loggingDirectives: LoggingDirectives12
}

export interface Interaction7 {
  accessibility: Accessibility
  onTap: OnTap18
}

export interface Accessibility {
  label: string
}

export interface OnTap18 {
  innertubeCommand: InnertubeCommand23
}

export interface InnertubeCommand23 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata21
  urlEndpoint: UrlEndpoint9
}

export interface CommandMetadata21 {
  webCommandMetadata: WebCommandMetadata21
}

export interface WebCommandMetadata21 {
  url: string
  webPageType: string
  rootVe: number
}

export interface UrlEndpoint9 {
  url: string
  target: string
  attributionSrcMode: string
}

export interface Label2 {
  content: string
}

export interface IconImage {
  sources: Source6[]
}

export interface Source6 {
  clientResource: ClientResource4
}

export interface ClientResource4 {
  imageName: string
}

export interface LoggingDirectives12 {
  trackingParams: string
  visibility: Visibility10
}

export interface Visibility10 {
  types: string
}

export interface LoggingDirectives13 {
  trackingParams: string
  visibility: Visibility11
}

export interface Visibility11 {
  types: string
}

export interface LoggingDirectives14 {
  trackingParams: string
  visibility: Visibility12
  attentionLogging: string
}

export interface Visibility12 {
  types: string
}

export interface OnFocusEffect {
  onFocusStyle: string
  onFocusColor?: OnFocusColor
  textPrimaryColor?: TextPrimaryColor
  textSecondaryColor?: TextSecondaryColor
  touchResponseColor?: TouchResponseColor
}

export interface OnFocusColor {
  lightTheme: number
  darkTheme: number
}

export interface TextPrimaryColor {
  lightTheme: number
  darkTheme: number
}

export interface TextSecondaryColor {
  lightTheme: number
  darkTheme: number
}

export interface TouchResponseColor {
  lightTheme: number
  darkTheme: number
}

export interface RichSectionRenderer {
  content: Content3
  trackingParams: string
}

export interface Content3 {
  chipsShelfWithVideoShelfRenderer: ChipsShelfWithVideoShelfRenderer
}

export interface ChipsShelfWithVideoShelfRenderer {
  chipsShelf: ChipsShelf
  targetId: string
  header: Header
  contentId: string
}

export interface ChipsShelf {
  chipsShelfViewModel: ChipsShelfViewModel
}

export interface ChipsShelfViewModel {
  contents: Content4[]
  numRowsShown: number
  isHorizontallyScrollable: boolean
  autoselectChipOnVisible: boolean
  autoselectedChipIndex: number
  nextButton: NextButton
  previousButton: PreviousButton
  loggingDirectives: LoggingDirectives16
}

export interface Content4 {
  chipViewModel: ChipViewModel
}

export interface ChipViewModel {
  text: string
  selected: boolean
  disabled: boolean
  displayType: string
  tapCommand: TapCommand
  chipShouldLogGestures: boolean
  loggingDirectives: LoggingDirectives15
}

export interface TapCommand {
  innertubeCommand: InnertubeCommand24
}

export interface InnertubeCommand24 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata22
  continuationCommand: ContinuationCommand
}

export interface CommandMetadata22 {
  webCommandMetadata: WebCommandMetadata22
}

export interface WebCommandMetadata22 {
  sendPost: boolean
  apiUrl: string
}

export interface ContinuationCommand {
  token: string
  request: string
  command: Command3
}

export interface Command3 {
  clickTrackingParams: string
  showReloadUiCommand: ShowReloadUiCommand
}

export interface ShowReloadUiCommand {
  targetId: string
}

export interface LoggingDirectives15 {
  trackingParams: string
  visibility: Visibility13
}

export interface Visibility13 {
  types: string
}

export interface NextButton {
  buttonViewModel: ButtonViewModel5
}

export interface ButtonViewModel5 {
  iconName: string
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface PreviousButton {
  buttonViewModel: ButtonViewModel6
}

export interface ButtonViewModel6 {
  iconName: string
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface LoggingDirectives16 {
  trackingParams: string
  visibility: Visibility14
}

export interface Visibility14 {
  types: string
}

export interface Header {
  sectionHeaderViewModel: SectionHeaderViewModel
}

export interface SectionHeaderViewModel {
  headline: Headline2
  trailingActions: TrailingActions
}

export interface Headline2 {
  content: string
}

export interface TrailingActions {
  flexibleActionsViewModel: FlexibleActionsViewModel
}

export interface FlexibleActionsViewModel {
  actionsRows: ActionsRow[]
}

export interface ActionsRow {
  actions: Action5[]
}

export interface Action5 {
  buttonViewModel: ButtonViewModel7
}

export interface ButtonViewModel7 {
  iconName: string
  onTap: OnTap19
  accessibilityText: string
  style: string
  trackingParams: string
  type: string
  buttonSize: string
  state: string
}

export interface OnTap19 {
  innertubeCommand: InnertubeCommand25
}

export interface InnertubeCommand25 {
  clickTrackingParams: string
  showSheetCommand: ShowSheetCommand3
}

export interface ShowSheetCommand3 {
  panelLoadingStrategy: PanelLoadingStrategy3
}

export interface PanelLoadingStrategy3 {
  inlineContent: InlineContent2
}

export interface InlineContent2 {
  sheetViewModel: SheetViewModel2
}

export interface SheetViewModel2 {
  content: Content5
}

export interface Content5 {
  listViewModel: ListViewModel2
}

export interface ListViewModel2 {
  listItems: ListItem2[]
}

export interface ListItem2 {
  listItemViewModel: ListItemViewModel2
}

export interface ListItemViewModel2 {
  title: Title3
  leadingImage: LeadingImage2
  rendererContext: RendererContext6
}

export interface Title3 {
  content: string
}

export interface LeadingImage2 {
  sources: Source7[]
}

export interface Source7 {
  clientResource: ClientResource5
}

export interface ClientResource5 {
  imageName: string
}

export interface RendererContext6 {
  commandContext: CommandContext5
}

export interface CommandContext5 {
  onTap: OnTap20
}

export interface OnTap20 {
  innertubeCommand: InnertubeCommand26
}

export interface InnertubeCommand26 {
  clickTrackingParams: string
  commandMetadata: CommandMetadata23
  userFeedbackEndpoint: UserFeedbackEndpoint
}

export interface CommandMetadata23 {
  webCommandMetadata: WebCommandMetadata23
}

export interface WebCommandMetadata23 {
  ignoreNavigation: boolean
}

export interface UserFeedbackEndpoint {
  hack: boolean
  additionalDatas: AdditionalData[]
}

export interface AdditionalData {
  userFeedbackEndpointProductSpecificValueData: UserFeedbackEndpointProductSpecificValueData
}

export interface UserFeedbackEndpointProductSpecificValueData {
  key: string
  value: string
}

export interface ContinuationItemRenderer {
  trigger: string
  continuationEndpoint: ContinuationEndpoint
  ghostCards: GhostCards
}

export interface ContinuationEndpoint {
  clickTrackingParams: string
  commandMetadata: CommandMetadata24
  continuationCommand: ContinuationCommand2
}

export interface CommandMetadata24 {
  webCommandMetadata: WebCommandMetadata24
}

export interface WebCommandMetadata24 {
  sendPost: boolean
  apiUrl: string
}

export interface ContinuationCommand2 {
  token: string
  request: string
}

export interface GhostCards {
  ghostGridRenderer: GhostGridRenderer
}

export interface GhostGridRenderer {
  rows: number
}

export interface AdsControlFlowOpportunityReceivedCommand {
  opportunityType: string
  isInitialLoad: boolean
  adSlotAndLayoutMetadata: AdSlotAndLayoutMetadaum[]
  enablePacfLoggingWeb: boolean
}

export interface AdSlotAndLayoutMetadaum {
  adSlotMetadata: AdSlotMetadata2
  adLayoutMetadata: AdLayoutMetadaum[]
}

export interface AdSlotMetadata2 {
  slotId: string
  slotType: string
  slotPhysicalPosition: number
  adSlotLoggingData: AdSlotLoggingData2
}

export interface AdSlotLoggingData2 {
  serializedSlotAdServingDataEntry: string
}

export interface AdLayoutMetadaum {
  layoutId: string
  layoutType: string
  adLayoutLoggingData: AdLayoutLoggingData2
}

export interface AdLayoutLoggingData2 {
  serializedAdServingDataEntry: string
}

export interface FrameworkUpdates {}
