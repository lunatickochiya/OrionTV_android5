import React, { forwardRef } from "react";
import { Animated, Pressable, StyleSheet, StyleProp, ViewStyle, PressableProps, TextStyle, View, Platform } from "react-native";
import { ThemedText } from "./ThemedText";
import { Colors } from "@/constants/Colors";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface StyledButtonProps extends PressableProps {
  children?: React.ReactNode;
  text?: string;
  variant?: "default" | "primary" | "ghost";
  isSelected?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const colors = Colors.dark;

// 模块级样式：内容全部静态（深色主题固定），避免每次 render 重建 5 个 StyleSheet。
// 之前剧集/分类等列表每次重渲染都会重复创建，千级按钮场景造成显著分配压力。
const baseStyles = StyleSheet.create({
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  focusedButton: {
    backgroundColor: colors.link,
    borderColor: colors.background,
    elevation: 5,
    shadowColor: colors.link,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
  },
  selectedButton: {
    backgroundColor: colors.tint,
  },
  text: {
    fontSize: 16,
    fontWeight: "500",
    color: colors.text,
  },
  selectedText: {
    color: Colors.dark.text,
  },
});

const variantStyles = {
  default: StyleSheet.create({
    button: {
      backgroundColor: colors.border,
    },
    text: {
      color: colors.text,
    },
    selectedButton: {
      backgroundColor: colors.primary,
    },
    focusedButton: {
      borderColor: colors.primary,
    },
    selectedText: {
      color: Colors.dark.text,
    },
  }),
  primary: StyleSheet.create({
    button: {
      backgroundColor: "transparent",
    },
    text: {
      color: colors.text,
    },
    focusedButton: {
      backgroundColor: colors.primary,
      borderColor: colors.background,
    },
    selectedButton: {
      backgroundColor: colors.primary,
    },
    selectedText: {
      color: colors.link,
    },
  }),
  ghost: StyleSheet.create({
    button: {
      backgroundColor: "transparent",
    },
    text: {
      color: colors.text,
    },
    focusedButton: {
      backgroundColor: "rgba(119, 119, 119, 0.2)",
      borderColor: colors.primary,
    },
    selectedButton: {},
    selectedText: {},
  }),
};

const StyledButtonBase = forwardRef<View, StyledButtonProps>(
  ({ children, text, variant = "default", isSelected = false, style, textStyle, ...rest }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const animationStyle = useButtonAnimation(isFocused);
    const deviceType = useResponsiveLayout().deviceType;

    return (
      <Animated.View style={[animationStyle, style]}>
        <Pressable
          android_ripple={Platform.isTV || deviceType !== 'tv'? { color: 'transparent' } : { color: Colors.dark.link }}
          ref={ref}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={({ focused }) => [
            baseStyles.button,
            variantStyles[variant].button,
            isSelected && (variantStyles[variant].selectedButton ?? baseStyles.selectedButton),
            focused && (variantStyles[variant].focusedButton ?? baseStyles.focusedButton),
          ]}
          {...rest}
        >
          {text ? (
            <ThemedText
              style={[
                baseStyles.text,
                variantStyles[variant].text,
                isSelected && (variantStyles[variant].selectedText ?? baseStyles.selectedText),
                textStyle,
              ]}
            >
              {text}
            </ThemedText>
          ) : (
            children
          )}
        </Pressable>
      </Animated.View>
    );
  }
);

// memo：列表场景下（剧集、分类等）props 未变的按钮可跳过整树重渲染
export const StyledButton = React.memo(StyledButtonBase);

StyledButton.displayName = "StyledButton";
StyledButtonBase.displayName = "StyledButtonBase";
