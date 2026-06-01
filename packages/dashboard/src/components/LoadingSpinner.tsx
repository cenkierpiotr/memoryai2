interface Props {
  text?: string;
}

export function LoadingSpinner({ text = 'Loading…' }: Props) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}
