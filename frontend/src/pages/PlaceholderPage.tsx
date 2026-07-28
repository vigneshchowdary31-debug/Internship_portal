export const PlaceholderPage = ({ title }: { title: string }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center space-y-4">
      <h1 className="text-3xl font-bold text-gray-800">{title}</h1>
      <p className="text-lg text-gray-500">
        This feature is under development and will be available in the upcoming modules.
      </p>
    </div>
  );
};
