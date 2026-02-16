import React from 'react';
import { toast } from './Toast';

interface Props {
  children: React.ReactNode;
  scope?: string;
  autoRecoverMs?: number;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  recoverCount: number;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  state: State = {
    hasError: false,
    errorMessage: '',
    recoverCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMessage: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[UI ErrorBoundary:${this.props.scope || 'app'}]`, error, errorInfo);
    toast('화면 오류를 감지했습니다. 자동 복구를 시도합니다.', 'error');

    const ms = this.props.autoRecoverMs ?? 1200;
    this.timer = setTimeout(() => {
      this.setState((s) => ({ hasError: false, errorMessage: '', recoverCount: s.recoverCount + 1 }));
    }, ms);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, errorMessage: '', recoverCount: s.recoverCount + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">
          <div className="font-semibold">⚠️ 화면 오류 발생</div>
          <div className="mt-1 text-sm text-red-200/90">{this.state.errorMessage || '렌더링 중 오류가 발생했습니다.'}</div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={this.handleRetry}
              className="px-3 py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-sm"
            >
              다시 시도
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-md bg-gray-700/60 hover:bg-gray-700/80 text-sm text-gray-100"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.recoverCount}>{this.props.children}</React.Fragment>;
  }
}
