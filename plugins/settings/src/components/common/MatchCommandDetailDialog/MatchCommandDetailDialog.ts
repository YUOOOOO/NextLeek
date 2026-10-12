import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface MatchCommandFeature {
  code?: string
  name?: string
  explain?: string
  [key: string]: any
}

export interface MatchCommandDetailCommand {
  text?: string
  label?: string
  name?: string
  type?: string
  match?: string | Record<string, any>
  regex?: string
  [key: string]: any
}

export interface SelectedMatchCommand {
  command: MatchCommandDetailCommand
  feature: MatchCommandFeature
  pluginName?: string
}

export interface UseMatchCommandDetailOptions {
  getPluginName?: () => string | undefined
  isDisabled?: (detail: SelectedMatchCommand) => boolean
  toggleDisabled?: (detail: SelectedMatchCommand) => void | Promise<void>
}

export interface UseMatchCommandDetailResult {
  selectedMatchCommand: Ref<SelectedMatchCommand | null>
  selectedMatchCommandDisabled: ComputedRef<boolean>
  openMatchCommandDetail: (feature: MatchCommandFeature, cmd: MatchCommandDetailCommand) => void
  closeMatchCommandDetail: () => void
  toggleSelectedMatchCommandDisabled: () => Promise<void>
  cmdKey: (cmd: MatchCommandDetailCommand | string) => string
  normalizeCommand: (cmd: MatchCommandDetailCommand | string) => MatchCommandDetailCommand
  isMatchCommand: (cmd: unknown) => boolean
}

export function useMatchCommandDetail(
  options: UseMatchCommandDetailOptions = {}
): UseMatchCommandDetailResult {
  const selectedMatchCommand = ref<SelectedMatchCommand | null>(null)

  const selectedMatchCommandDisabled = computed(() => {
    const detail = selectedMatchCommand.value
    if (!detail || !options.isDisabled) return false
    return options.isDisabled(detail)
  })

  function cmdKey(cmd: MatchCommandDetailCommand | string): string {
    if (cmd && typeof cmd === 'object') {
      return cmd.label || cmd.text || cmd.name || ''
    }
    return String(cmd)
  }

  function normalizeCommand(cmd: MatchCommandDetailCommand | string): MatchCommandDetailCommand {
    if (cmd && typeof cmd === 'object') {
      return {
        name: cmd.label || cmd.name,
        text: cmd.label,
        type: cmd.type,
        match: cmd.match
      }
    }
    return {
      text: String(cmd),
      type: 'text'
    }
  }

  function isMatchCommand(cmd: unknown): boolean {
    return Boolean(
      cmd &&
      typeof cmd === 'object' &&
      'type' in cmd &&
      (cmd as MatchCommandDetailCommand).type &&
      (cmd as MatchCommandDetailCommand).type !== 'text'
    )
  }

  function openMatchCommandDetail(
    feature: MatchCommandFeature,
    cmd: MatchCommandDetailCommand
  ): void {
    const rawMatch =
      cmd.match && typeof cmd.match === 'object'
        ? cmd.match
        : { match: cmd.match || cmd.regex || '' }

    selectedMatchCommand.value = {
      command: {
        ...cmd,
        ...rawMatch,
        type: cmd.type,
        label: cmd.label || cmd.name
      },
      feature: {
        code: feature.code,
        name: feature.name,
        explain: feature.explain
      },
      pluginName: options.getPluginName?.() || ''
    }
  }

  function closeMatchCommandDetail(): void {
    selectedMatchCommand.value = null
  }

  async function toggleSelectedMatchCommandDisabled(): Promise<void> {
    const detail = selectedMatchCommand.value
    if (!detail || !options.toggleDisabled) return
    await options.toggleDisabled(detail)
  }

  return {
    selectedMatchCommand,
    selectedMatchCommandDisabled,
    openMatchCommandDetail,
    closeMatchCommandDetail,
    toggleSelectedMatchCommandDisabled,
    cmdKey,
    normalizeCommand,
    isMatchCommand
  }
}
