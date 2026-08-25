package fixtures;

public final class PortSample {
    // Commands.literal("comment only")
    /* BakedModelWrapper in a block comment */
    private final String documentation = "Commands.literal(\"inside a string\")";
    private final String blockId = "minecraft:grass";

    public void command() {
        Commands.literal("run");
        Blocks.grass.defaultBlockState();
        BakedModelWrapper wrapper = null;
        System.out.println(wrapper);
    }
}
